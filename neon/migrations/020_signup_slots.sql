-- 020_signup_slots.sql (ADR-066). Apply BEFORE redeploying submitresponse (Wave D), then refresh the
-- Data API schema cache (`neonctl data-api refresh-schema`): the studio calls move_signup_slot.
-- The Wave C submitresponse keeps working with 020 applied (it selects only the columns it knows), and
-- already has its slots enforced: the capacity check below reads the answers, not the Function.
--
-- What this adds (sign-up slots with limited spots):
--   1. forms.signup_slots: the published slots of a form, { question_id: { slot_value: capacity } }, or
--      null. A trigger derives it from published_schema on every write (signup_slots_of below applies
--      the engine's signupSlotsOf rule), and pins it otherwise, so no client can set it.
--   2. signup_claims: one row per spot taken, derived from submissions.answers by a trigger on every
--      insert and every change to answers, deleted_at or form_id. Only live responses hold claims, so
--      trashing a response frees its spot and restoring it takes the spot back (even past capacity: an
--      owner action, shown as "over" in the studio). Waitlists aren't claims; they live in the answer.
--   3. insert_public_submission (019) grows the slot check: under the same per-form lock as the response
--      cap (87123003), it counts each requested slot's claims and refuses with 'slot_full' (naming the
--      full slots and every slot's spots left) at capacity, so a slot is exact under concurrent submits.
--      The insert's trigger writes the claims before the lock is released.
--   4. signup_left(form_id, def): spots left per slot, for the public lookup (op=form / unlock) and 409s.
--   5. move_signup_slot: the owner moves a person between slots (or takes them off a waitlist) in the
--      studio. Owner-checked (auth_uid), same lock, refuses a full slot unless p_force.
--
-- No anonymous access to any of it: the table has RLS forced and no Data API grants; only
-- move_signup_slot is granted, to authenticated, and it checks ownership itself.
-- Advisory lock keys: 87123001 form quota (010), 87123002 AI quota (014) + slug lock (015),
-- 87123003 response cap (019) and sign-up slots (here — one lock per form for both).
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The published slots of a form.
-- ---------------------------------------------------------------------------
-- The engine's rule (src/logic/signup.ts signupSlotsOf): among a question's first 50 slot entries,
-- those with a value matching ^[A-Za-z0-9_-]{1,64}$ and a whole-number capacity from 1 to 1000; the
-- first of each value. A question id used twice: the last question wins, as in the Function's map.
create or replace function public.signup_slots_of(p_schema jsonb)
returns jsonb
language sql immutable parallel safe
set search_path = public, pg_temp
as $fn$
  select jsonb_object_agg(t.qid, t.caps)
    from (
      -- The last question with each id decides (the Function keeps the last one too); it counts
      -- only when it is a sign-up question with at least one usable slot.
      select distinct on (q.value->>'id') q.value->>'id' as qid, q.value->>'type' as qtype, c.caps
        from jsonb_array_elements(
               case when jsonb_typeof(p_schema->'questions') = 'array'
                    then p_schema->'questions' else '[]'::jsonb end
             ) with ordinality as q(value, qord)
        cross join lateral (
          select jsonb_object_agg(s.v, s.cap) as caps
            from (
              select distinct on (e->>'value') e->>'value' as v, k.cap::int as cap
                from jsonb_array_elements(
                       case when jsonb_typeof(q.value->'slots') = 'array'
                            then q.value->'slots' else '[]'::jsonb end
                     ) with ordinality as x(e, ord)
                -- A CASE, not a WHERE clause, guards the cast: WHERE has no evaluation order.
                cross join lateral (
                  select case when jsonb_typeof(e->'capacity') = 'number'
                              then (e->'capacity')::numeric end as cap
                ) k
               where x.ord <= 50
                 and jsonb_typeof(e) = 'object'
                 and jsonb_typeof(e->'value') = 'string'
                 and (e->>'value') ~ '^[A-Za-z0-9_-]{1,64}$'
                 and k.cap between 1 and 1000
                 and k.cap = trunc(k.cap)
               order by e->>'value', x.ord
            ) s
        ) c
       where jsonb_typeof(q.value) = 'object'
         and jsonb_typeof(q.value->'id') = 'string'
       order by q.value->>'id', q.qord desc
    ) t
   where t.qtype = 'signup_slots' and t.caps is not null;
$fn$;

alter table public.forms add column if not exists signup_slots jsonb;

-- Backfill (no trigger yet, updated_at untouched). Production has no sign-up questions today.
alter table public.forms disable trigger forms_set_updated_at;
update public.forms
   set signup_slots = public.signup_slots_of(published_schema)
 where published_schema is not null
   and public.signup_slots_of(published_schema) is distinct from signup_slots;
alter table public.forms enable trigger forms_set_updated_at;

-- Derived on every write, pinned otherwise: a client-sent value is always replaced.
-- SECURITY DEFINER: studio saves run as `authenticated`, which may not call signup_slots_of.
create or replace function public.forms_signup_slots()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' or new.published_schema is distinct from old.published_schema then
    new.signup_slots := public.signup_slots_of(new.published_schema);
  else
    new.signup_slots := old.signup_slots;
  end if;
  return new;
end;
$fn$;

drop trigger if exists forms_signup_slots on public.forms;
create trigger forms_signup_slots
  before insert or update on public.forms
  for each row execute function public.forms_signup_slots();

-- ---------------------------------------------------------------------------
-- 2. Claims: one row per spot taken by a live response.
-- ---------------------------------------------------------------------------
create table if not exists public.signup_claims (
  submission_id text not null
    references public.submissions (id) on delete cascade on update cascade,
  form_id text not null,
  question_id text not null,
  slot text not null,
  claimed_at timestamptz not null,
  primary key (submission_id, question_id, slot)
);

-- Counting one slot is an index-only scan over at most its capacity (plus any owner overbooking).
create index if not exists signup_claims_slot_idx
  on public.signup_claims (form_id, question_id, slot);

alter table public.signup_claims enable row level security;
alter table public.signup_claims force row level security;
revoke all on table public.signup_claims from public;
do $$ begin
  revoke all on table public.signup_claims from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists signup_claims_owner_role_all on public.signup_claims;
create policy signup_claims_owner_role_all on public.signup_claims
  for all to neondb_owner using (true) with check (true);

-- Every path that writes a response keeps its claims in step: the submit Function's insert, the
-- studio's own test runs and backup restores (Data API inserts), trash / restore / move (updates).
-- Row lock first (the UPDATE holds it), then the form lock — the same order move_signup_slot uses.
create or replace function public.submissions_signup_claims()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_def jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.answers is not distinct from old.answers
       and (new.deleted_at is null) = (old.deleted_at is null)
       and new.form_id = old.form_id
       and new.id = old.id then
      return null;
    end if;
    delete from public.signup_claims where submission_id in (old.id, new.id);
  end if;
  if new.deleted_at is not null then
    return null;
  end if;
  select f.signup_slots into v_def from public.forms f where f.id = new.form_id;
  if v_def is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(87123003, hashtext(new.form_id));
  insert into public.signup_claims (submission_id, form_id, question_id, slot, claimed_at)
  select new.id, new.form_id, q.key, s.slot, new.received_at
    from jsonb_each(v_def) q
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(new.answers->q.key->'slots') = 'array'
           then new.answers->q.key->'slots' else '[]'::jsonb end
    ) s(slot)
   where q.value ? s.slot
  on conflict do nothing;
  return null;
end;
$fn$;

drop trigger if exists submissions_signup_claims on public.submissions;
create trigger submissions_signup_claims
  after insert or update on public.submissions
  for each row execute function public.submissions_signup_claims();

-- Backfill claims for live responses to forms that already publish slots (none on production today).
insert into public.signup_claims (submission_id, form_id, question_id, slot, claimed_at)
select sb.id, sb.form_id, q.key, s.slot, sb.received_at
  from public.submissions sb
  join public.forms f on f.id = sb.form_id and f.signup_slots is not null
  cross join lateral jsonb_each(f.signup_slots) q
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(sb.answers->q.key->'slots') = 'array'
         then sb.answers->q.key->'slots' else '[]'::jsonb end
  ) s(slot)
 where sb.deleted_at is null and q.value ? s.slot
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Spots left, per question and slot: { question_id: { slot_value: left } }, or null.
-- ---------------------------------------------------------------------------
create or replace function public.signup_left(p_form_id text, p_def jsonb)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $fn$
  select jsonb_object_agg(q.key, (
           select jsonb_object_agg(s.key, greatest(0, s.value::text::int - (
                    select count(*)::int from public.signup_claims c
                     where c.form_id = p_form_id and c.question_id = q.key and c.slot = s.key)))
             from jsonb_each(q.value) s))
    from jsonb_each(p_def) q
   where p_def is not null and jsonb_typeof(p_def) = 'object';
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The submit Function's insert, now with the slot check (019's body otherwise unchanged).
-- ---------------------------------------------------------------------------
-- The return type grows, so the function is dropped and re-created in this transaction.
drop function if exists public.insert_public_submission(text, text, jsonb, jsonb);
create function public.insert_public_submission(
  p_id text, p_form_id text, p_answers jsonb, p_meta jsonb)
returns table (outcome text, closed_message text, full_slots jsonb, slots_left jsonb)
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  f record;
  n integer;
  v_full jsonb;
begin
  if p_id is null or p_form_id is null or p_answers is null or p_meta is null then
    raise exception 'insert_public_submission: bad arguments' using errcode = '22023';
  end if;

  select fo.status, fo.deleted_at, fo.closes_at, fo.max_responses, fo.closed_message, fo.signup_slots
    into f
    from public.forms fo
   where fo.id = p_form_id;
  if not found or f.deleted_at is not null or f.status <> 'published' then
    return query select 'gone'::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;

  if f.closes_at is not null and f.closes_at <= now() then
    return query select 'closed'::text, f.closed_message, null::jsonb, null::jsonb;
    return;
  end if;

  -- One submit at a time per form with a cap or slots, so N concurrent submits for the last spot
  -- store one. Released at commit, after the insert and its claims are visible to the next holder.
  if f.max_responses is not null or f.signup_slots is not null then
    perform pg_advisory_xact_lock(87123003, hashtext(p_form_id));
  end if;

  if f.max_responses is not null then
    select count(*) into n
      from public.submissions s
     where s.form_id = p_form_id and s.deleted_at is null;
    if n >= f.max_responses then
      return query select 'full'::text, f.closed_message, null::jsonb, null::jsonb;
      return;
    end if;
  end if;

  if f.signup_slots is not null then
    select jsonb_agg(jsonb_build_object('question', r.q, 'slot', r.slot) order by r.q, r.ord)
      into v_full
      from (
        select q.key as q, s.slot, s.ord, (q.value->>s.slot)::int as cap
          from jsonb_each(f.signup_slots) q
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(p_answers->q.key->'slots') = 'array'
                 then p_answers->q.key->'slots' else '[]'::jsonb end
          ) with ordinality as s(slot, ord)
         where q.value ? s.slot
      ) r
     where (select count(*) from public.signup_claims c
             where c.form_id = p_form_id and c.question_id = r.q and c.slot = r.slot) >= r.cap;
    if v_full is not null then
      return query select 'slot_full'::text, null::text, v_full,
        public.signup_left(p_form_id, f.signup_slots);
      return;
    end if;
  end if;

  insert into public.submissions (id, form_id, answers, meta, received_at)
  values (p_id, p_form_id, p_answers, p_meta, now());
  return query select 'ok'::text, null::text, null::jsonb, null::jsonb;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The owner moves someone (studio roster).
-- ---------------------------------------------------------------------------
-- Out of p_from (a slot they hold or wait for) and into p_to as a taken spot, added last: the engine's
-- moveSignupAnswer (examples/_admin/signupMove.ts). p_from = p_to takes someone off that slot's waitlist.
-- Outcomes: ok | full (p_to is at capacity; p_force overbooks on purpose) | not_found (no such live
-- response of yours, or they no longer hold p_from) | bad_slot (p_to isn't a published slot).
create or replace function public.move_signup_slot(
  p_submission_id text, p_question_id text, p_from text, p_to text, p_force boolean default false)
returns table (outcome text, taken integer, capacity integer)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_uid text := public.auth_uid();
  s record;
  v_caps jsonb;
  v_ans jsonb;
  v_cap integer;
  v_n integer;
  v_slots jsonb;
  v_wait jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_submission_id is null or p_question_id is null or p_from is null or p_to is null then
    raise exception 'move_signup_slot: bad arguments' using errcode = '22023';
  end if;

  -- The response's row lock first, then the form lock (the claims trigger's order).
  select sb.form_id, sb.answers, sb.deleted_at, f.owner_id, f.signup_slots
    into s
    from public.submissions sb
    join public.forms f on f.id = sb.form_id
   where sb.id = p_submission_id
     for update of sb;
  -- "Not yours" and "doesn't exist" read the same (fail closed, no oracle).
  if not found or s.owner_id is distinct from v_uid or s.deleted_at is not null then
    return query select 'not_found'::text, null::int, null::int;
    return;
  end if;

  v_caps := s.signup_slots -> p_question_id;
  if v_caps is null or jsonb_typeof(v_caps) <> 'object' or not (v_caps ? p_to) then
    return query select 'bad_slot'::text, null::int, null::int;
    return;
  end if;

  v_ans := s.answers -> p_question_id;
  v_slots := case when jsonb_typeof(v_ans->'slots') = 'array' then v_ans->'slots' else '[]'::jsonb end;
  v_wait := case when jsonb_typeof(v_ans->'wait') = 'array' then v_ans->'wait' else '[]'::jsonb end;
  if not (v_slots ? p_from or v_wait ? p_from) then
    return query select 'not_found'::text, null::int, null::int;
    return;
  end if;

  perform pg_advisory_xact_lock(87123003, hashtext(s.form_id));
  v_cap := (v_caps->>p_to)::int;
  select count(*)::int into v_n
    from public.signup_claims c
   where c.form_id = s.form_id and c.question_id = p_question_id and c.slot = p_to
     and c.submission_id <> p_submission_id;
  if v_n >= v_cap and not coalesce(p_force, false) then
    return query select 'full'::text, v_n, v_cap;
    return;
  end if;

  v_slots := coalesce((
    select jsonb_agg(e order by x.ord) from jsonb_array_elements(v_slots) with ordinality as x(e, ord)
     where e not in (to_jsonb(p_from), to_jsonb(p_to))), '[]'::jsonb) || jsonb_build_array(p_to);
  v_wait := (
    select jsonb_agg(e order by x.ord) from jsonb_array_elements(v_wait) with ordinality as x(e, ord)
     where e not in (to_jsonb(p_from), to_jsonb(p_to)));
  update public.submissions
     set answers = jsonb_set(
           answers,
           array[p_question_id],
           jsonb_build_object('slots', v_slots)
             || case when v_wait is null then '{}'::jsonb else jsonb_build_object('wait', v_wait) end)
   where id = p_submission_id;
  return query select 'ok'::text, v_n + 1, v_cap;
end;
$fn$;

-- Grants: nothing for the Data API roles except the owner-checked move.
revoke all on function public.signup_slots_of(jsonb) from public;
revoke all on function public.forms_signup_slots() from public;
revoke all on function public.submissions_signup_claims() from public;
revoke all on function public.signup_left(text, jsonb) from public;
revoke all on function public.insert_public_submission(text, text, jsonb, jsonb) from public;
revoke all on function public.move_signup_slot(text, text, text, text, boolean) from public;
do $$ begin
  revoke all on function public.signup_slots_of(jsonb) from anonymous, authenticated;
  revoke all on function public.forms_signup_slots() from anonymous, authenticated;
  revoke all on function public.submissions_signup_claims() from anonymous, authenticated;
  revoke all on function public.signup_left(text, jsonb) from anonymous, authenticated;
  revoke all on function public.insert_public_submission(text, text, jsonb, jsonb)
    from anonymous, authenticated;
  revoke all on function public.move_signup_slot(text, text, text, text, boolean) from anonymous;
  grant execute on function public.move_signup_slot(text, text, text, text, boolean) to authenticated;
exception when undefined_object then null; end $$;

commit;

-- Rollback (ADR-066), only after submitresponse is back on its Wave C build (the Wave D build reads
-- forms.signup_slots and signup_left). Restores 019's insert_public_submission. Responses and their
-- answers are untouched; slot capacity simply stops being enforced.
--   begin;
--   drop trigger if exists submissions_signup_claims on public.submissions;
--   drop trigger if exists forms_signup_slots on public.forms;
--   drop function if exists public.move_signup_slot(text, text, text, text, boolean);
--   drop function if exists public.insert_public_submission(text, text, jsonb, jsonb);
--   create function public.insert_public_submission(
--     p_id text, p_form_id text, p_answers jsonb, p_meta jsonb)
--   returns table (outcome text, closed_message text)
--   language plpgsql volatile security definer set search_path = public as $fn$
--   declare f record; n integer;
--   begin
--     if p_id is null or p_form_id is null or p_answers is null or p_meta is null then
--       raise exception 'insert_public_submission: bad arguments' using errcode = '22023';
--     end if;
--     select fo.status, fo.deleted_at, fo.closes_at, fo.max_responses, fo.closed_message into f
--       from public.forms fo where fo.id = p_form_id;
--     if not found or f.deleted_at is not null or f.status <> 'published' then
--       return query select 'gone'::text, null::text; return;
--     end if;
--     if f.closes_at is not null and f.closes_at <= now() then
--       return query select 'closed'::text, f.closed_message; return;
--     end if;
--     if f.max_responses is not null then
--       perform pg_advisory_xact_lock(87123003, hashtext(p_form_id));
--       select count(*) into n from public.submissions s
--        where s.form_id = p_form_id and s.deleted_at is null;
--       if n >= f.max_responses then
--         return query select 'full'::text, f.closed_message; return;
--       end if;
--     end if;
--     insert into public.submissions (id, form_id, answers, meta, received_at)
--     values (p_id, p_form_id, p_answers, p_meta, now());
--     return query select 'ok'::text, null::text;
--   end; $fn$;
--   revoke all on function public.insert_public_submission(text, text, jsonb, jsonb) from public;
--   revoke all on function public.insert_public_submission(text, text, jsonb, jsonb)
--     from anonymous, authenticated;
--   drop function if exists public.signup_left(text, jsonb);
--   drop function if exists public.submissions_signup_claims();
--   drop function if exists public.forms_signup_slots();
--   drop table if exists public.signup_claims;
--   alter table public.forms drop column if exists signup_slots;
--   drop function if exists public.signup_slots_of(jsonb);
--   commit;
--   then: neonctl data-api refresh-schema
