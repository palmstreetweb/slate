-- 021_storage_quotas.sql (ADR-067, security plan step 11). Apply BEFORE redeploying storagesign and
-- submitresponse, then refresh the Data API schema cache (`neonctl data-api refresh-schema`): the studio
-- calls storage_quota_status for its meter (on a stale cache the meter just stays hidden).
-- Today's Functions keep working with 021 applied: storagesign 14 never touches the new tables (the
-- objects it signs get their rows from scripts/backfill-storage-uploads.ts), and submitresponse 11 calls
-- the 4-argument insert_public_submission, which is unchanged; the new claim trigger claims for it.
--
-- What this adds:
--   1. form_uploads: one row per object storagesign signs. The key is chosen by the server; the row holds
--      the form owner it is charged to, the form, the question, the declared bytes (the signed PUT is
--      bound to exactly that Content-Length), the type, when, and the response that claimed it. A row is
--      'pending' until a response claims it, 'claimed' while that response exists, and 'doomed' once the
--      response or form is permanently deleted, until the sweep deletes the object and the row.
--   2. The per-owner quota: an owner's claimed bytes plus pending bytes younger than 24 h stay at or
--      under storage_quota_limit() (1 GiB), with at most storage_pending_limit() (5,000) pending uploads.
--      reserve_upload checks and records a sign under a per-owner advisory lock (87123004), so N
--      concurrent signs against a nearly full quota store exactly what fits. storage_global_limit()
--      (100 GiB) caps the whole bucket against a total the sweep gate refreshes (about a minute stale).
--      Doomed bytes stop counting against the owner at once, and count toward the global total until
--      the object is gone.
--   3. Claims. insert_public_submission gains a 6-argument form for the submit Function: every file key
--      the answers reference must be this form's, minted for that question (or a legacy row with no
--      question), and pending and younger than 24 h, or already claimed by this same response. Anything
--      else is 'bad_files' (the Function answers 400) and nothing is stored. The rows are locked in key
--      order, so two submits naming the same key serialize and the second is refused. submit_key (a
--      client UUID per fill) makes a retried submit return the response it already stored instead of a
--      duplicate. The claim itself is the trigger submissions_claim_uploads, on every insert into
--      submissions (the Function's, the studio's test runs, backup restores) and every change to answers:
--      it claims the pending, unexpired rows of the same form the answers reference.
--   4. Deletes: submissions_doom_uploads and forms_doom_uploads mark the rows of a permanently deleted
--      response or form 'doomed'. Trash (deleted_at) changes nothing: trashed responses keep their files.
--      A response inserted again while its files are still there (the studio's backup restore deletes
--      every response, then inserts them) takes them back; the global sweep waits 2 min for that.
--   5. The sweep, run by storagesign with no new infrastructure: reserve_upload claims a gate row at most
--      once a minute and says so (sweep_due); storage_sweep_begin then leases a bounded batch (doomed
--      objects first, then pending uploads past 24 h, then one HEAD per upload 30 min after it was
--      signed, so a sign that never uploaded stops counting), and storage_sweep_finish records what was
--      deleted or checked. Leases (5 min) keep two sweeps off the same rows and retry what failed.
--      With p_owner set, storage_sweep_begin leases only that owner's doomed rows (the studio's purge after
--      a permanent delete), outside the gate.
--   6. storage_quota_status(): the signed-in owner's own bytes, for the studio meter.
--   7. storage_legacy_until(): 72 h after this migration first ran. Until then storagesign still signs the
--      old client-chosen paths (recorded like any other upload, with no question), and a submit may
--      reference a key with no row at all if it sits under the form's own prefix (claimed with its bytes
--      unknown until the sweep checks it), so a respondent who loaded the page before the deploy can finish.
--   8. submissions.submit_key: see 3.
--
-- Nothing is granted to the Data API roles except storage_quota_status (authenticated; it reads only the
-- caller's rows). form_uploads and storage_sweep_state have RLS forced and no Data API grants.
-- Advisory lock keys: 87123001 form quota (010), 87123002 AI quota (014) + slug lock (015), 87123003
-- response cap (019) + sign-up slots (020), 87123004 storage quota (here — one lock per owner).
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Numbers. Change one here (create or replace), then nothing else: every check reads these.
-- ---------------------------------------------------------------------------
create or replace function public.storage_quota_limit()
returns bigint language sql immutable as $fn$ select 1073741824::bigint $fn$; -- 1 GiB per account

create or replace function public.storage_pending_limit()
returns integer language sql immutable as $fn$ select 5000 $fn$; -- uploads awaiting a response, per account

create or replace function public.storage_global_limit()
returns bigint language sql immutable as $fn$ select 107374182400::bigint $fn$; -- 100 GiB, whole bucket

create or replace function public.storage_pending_ttl()
returns interval language sql immutable as $fn$ select interval '24 hours' $fn$;

-- Fixed the first time 021 runs (re-applying keeps it). Extend or end it early with create or replace.
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'storage_legacy_until'
  ) then
    execute format(
      'create function public.storage_legacy_until() returns timestamptz language sql immutable '
      'as $f$ select %L::timestamptz $f$',
      now() + interval '72 hours');
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 1. Uploads.
-- ---------------------------------------------------------------------------
create table if not exists public.form_uploads (
  key text primary key,
  -- The account charged: the form's owner when it was signed. No foreign keys on purpose: a row must
  -- outlive its form or response until the sweep has deleted the object.
  owner_id text not null,
  form_id text not null,
  -- null: signed by an old page (no question in the request), or registered by the backfill.
  question_id text,
  scope text not null,
  bytes bigint not null,
  content_type text not null,
  created_at timestamptz not null default now(),
  state text not null default 'pending',
  submission_id text,
  claimed_at timestamptz,
  -- The sweep saw the object (or its absence) with a HEAD.
  verified_at timestamptz,
  legacy boolean not null default false,
  lease_until timestamptz,
  -- When its response or form was permanently deleted.
  doomed_at timestamptz,
  constraint form_uploads_key_shape check (
    key ~ '^(public|draft)/[A-Za-z0-9_-]{4,64}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]{1,120}$'
  ),
  constraint form_uploads_key_parts check (
    scope in ('public', 'draft') and split_part(key, '/', 1) = scope and split_part(key, '/', 2) = form_id
  ),
  constraint form_uploads_bytes check (bytes between 0 and 1073741824),
  constraint form_uploads_type check (char_length(content_type) between 1 and 255),
  constraint form_uploads_question check (question_id is null or char_length(question_id) between 1 and 128),
  constraint form_uploads_owner check (char_length(owner_id) between 1 and 256),
  constraint form_uploads_state check (state in ('pending', 'claimed', 'doomed')),
  constraint form_uploads_pending check (state <> 'pending' or submission_id is null),
  constraint form_uploads_claimed check (state <> 'claimed' or submission_id is not null)
);

-- The quota sum: an index-only scan over the owner's live rows.
create index if not exists form_uploads_owner_live_idx
  on public.form_uploads (owner_id, state, created_at) include (bytes) where state <> 'doomed';
create index if not exists form_uploads_submission_idx
  on public.form_uploads (submission_id) where submission_id is not null;
create index if not exists form_uploads_form_idx on public.form_uploads (form_id);
create index if not exists form_uploads_doomed_idx
  on public.form_uploads (owner_id, created_at) where state = 'doomed';
create index if not exists form_uploads_pending_age_idx
  on public.form_uploads (created_at) where state = 'pending';
create index if not exists form_uploads_unverified_idx
  on public.form_uploads (created_at) where verified_at is null and state <> 'doomed';

alter table public.form_uploads enable row level security;
alter table public.form_uploads force row level security;
revoke all on table public.form_uploads from public;
do $$ begin
  revoke all on table public.form_uploads from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists form_uploads_owner_role_all on public.form_uploads;
create policy form_uploads_owner_role_all on public.form_uploads
  for all to neondb_owner using (true) with check (true);

-- The sweep gate and the global total it refreshes. One row.
create table if not exists public.storage_sweep_state (
  id integer primary key check (id = 1),
  next_run_at timestamptz not null default now(),
  global_bytes bigint not null default 0,
  global_at timestamptz
);
insert into public.storage_sweep_state (id) values (1) on conflict (id) do nothing;

alter table public.storage_sweep_state enable row level security;
alter table public.storage_sweep_state force row level security;
revoke all on table public.storage_sweep_state from public;
do $$ begin
  revoke all on table public.storage_sweep_state from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists storage_sweep_state_owner_role_all on public.storage_sweep_state;
create policy storage_sweep_state_owner_role_all on public.storage_sweep_state
  for all to neondb_owner using (true) with check (true);

-- A retried submit returns the response it already stored (3).
alter table public.submissions add column if not exists submit_key uuid;
create unique index if not exists submissions_submit_key_uidx
  on public.submissions (form_id, submit_key) where submit_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Reserve: the quota check and the row, in one statement per sign.
-- ---------------------------------------------------------------------------
-- Outcomes: ok | quota (the owner's bytes) | pending (too many unclaimed uploads) | global (the bucket
-- ceiling) | exists (a legacy path that is already taken) | legacy_closed (an old page past the grace).
-- sweep_due: this caller claimed the sweep gate and should run one batch (storage_sweep_begin).
create or replace function public.reserve_upload(
  p_key text, p_owner text, p_form_id text, p_question text, p_bytes bigint, p_type text,
  p_legacy boolean)
returns table (outcome text, used_bytes bigint, max_bytes bigint, sweep_due boolean)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_used bigint;
  v_pending integer;
  v_max bigint := public.storage_quota_limit();
  v_due boolean := false;
  v_global bigint;
begin
  if p_key is null or p_owner is null or p_owner = '' or p_form_id is null or p_bytes is null
     or p_bytes < 1 or p_bytes > 1073741824 or p_type is null or p_legacy is null
     or split_part(p_key, '/', 2) <> p_form_id then
    raise exception 'reserve_upload: bad arguments' using errcode = '22023';
  end if;

  if p_legacy and now() >= public.storage_legacy_until() then
    return query select 'legacy_closed'::text, null::bigint, v_max, false;
    return;
  end if;

  -- The sweep gate first, so a refused sign still lets the sweep free space. Once a minute, one caller;
  -- SKIP LOCKED, so the other signs at that moment neither wait for the gate nor for the recount.
  update public.storage_sweep_state s
     set next_run_at = now() + interval '55 seconds',
         global_bytes = (select coalesce(sum(u.bytes), 0) from public.form_uploads u),
         global_at = now()
   where s.id = (select g.id from public.storage_sweep_state g
                  where g.id = 1 and g.next_run_at <= now()
                    for update skip locked);
  v_due := found;
  select s.global_bytes into v_global from public.storage_sweep_state s where s.id = 1;

  -- One sign at a time per owner: the sum below and the insert are exact under concurrency.
  perform pg_advisory_xact_lock(87123004, hashtext(p_owner));

  select coalesce(sum(u.bytes), 0)::bigint,
         (count(*) filter (where u.state = 'pending'))::integer
    into v_used, v_pending
    from public.form_uploads u
   where u.owner_id = p_owner
     and (u.state = 'claimed'
          or (u.state = 'pending' and u.created_at > now() - public.storage_pending_ttl()));

  if v_used + p_bytes > v_max then
    return query select 'quota'::text, v_used, v_max, v_due;
    return;
  end if;
  if v_pending >= public.storage_pending_limit() then
    return query select 'pending'::text, v_used, v_max, v_due;
    return;
  end if;
  if coalesce(v_global, 0) + p_bytes > public.storage_global_limit() then
    return query select 'global'::text, v_used, v_max, v_due;
    return;
  end if;

  insert into public.form_uploads
    (key, owner_id, form_id, question_id, scope, bytes, content_type, legacy)
  values
    (p_key, p_owner, p_form_id, nullif(p_question, ''), split_part(p_key, '/', 1), p_bytes,
     left(p_type, 255), p_legacy)
  on conflict (key) do nothing;
  if not found then
    return query select 'exists'::text, v_used, v_max, v_due;
    return;
  end if;

  return query select 'ok'::text, v_used + p_bytes, v_max, v_due;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Claims.
-- ---------------------------------------------------------------------------
-- Every storage ref anywhere in an answers document, as an object key.
create or replace function public.upload_keys_of(p_answers jsonb)
returns setof text
language sql immutable parallel safe
set search_path = public, pg_temp
as $fn$
  select distinct substr(v #>> '{}', 22)
    from jsonb_path_query(coalesce(p_answers, '{}'::jsonb), 'strict $.**') v
   where jsonb_typeof(v) = 'string'
     and (v #>> '{}') like 'slate-file://storage:%';
$fn$;

-- Claims the pending, unexpired uploads of the same form that a stored response references.
-- AFTER INSERT and after a change to answers; also follows a response whose id changes. Named to fire
-- before submissions_signup_claims (020), so every path takes upload rows before the form lock.
-- A doomed row whose object is still there comes back too: the studio's backup restore deletes every
-- response and inserts them again, and must not lose their files. Not while a sweep holds it (its
-- delete may be in flight); a revived row is checked again (HEAD) in case an earlier sweep died mid-way.
create or replace function public.submissions_claim_uploads()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id then
      update public.form_uploads u set submission_id = new.id where u.submission_id = old.id;
    end if;
    if new.answers is not distinct from old.answers then
      return null;
    end if;
  end if;
  update public.form_uploads u
     set state = 'claimed', submission_id = new.id, claimed_at = now(),
         verified_at = case when u.state = 'doomed' then null else u.verified_at end,
         doomed_at = null
   where u.key in (select public.upload_keys_of(new.answers))
     and u.form_id = new.form_id
     and ((u.state = 'pending' and u.created_at > now() - public.storage_pending_ttl())
          or (u.state = 'doomed' and (u.lease_until is null or u.lease_until < now())));
  return null;
end;
$fn$;

drop trigger if exists submissions_claim_uploads on public.submissions;
create trigger submissions_claim_uploads
  after insert or update on public.submissions
  for each row execute function public.submissions_claim_uploads();

-- ---------------------------------------------------------------------------
-- 4. Permanent deletes doom their uploads (they stop counting now; the sweep deletes the objects).
-- ---------------------------------------------------------------------------
create or replace function public.submissions_doom_uploads()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.form_uploads u
     set state = 'doomed', lease_until = null, doomed_at = now()
   where u.submission_id = old.id and u.state = 'claimed';
  return null;
end;
$fn$;

drop trigger if exists submissions_doom_uploads on public.submissions;
create trigger submissions_doom_uploads
  after delete on public.submissions
  for each row execute function public.submissions_doom_uploads();

create or replace function public.forms_doom_uploads()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.form_uploads u
     set state = 'doomed', lease_until = null, doomed_at = now()
   where u.form_id = old.id and u.state <> 'doomed';
  return null;
end;
$fn$;

drop trigger if exists forms_doom_uploads on public.forms;
create trigger forms_doom_uploads
  after delete on public.forms
  for each row execute function public.forms_doom_uploads();

-- ---------------------------------------------------------------------------
-- 3. The submit Function's insert, with the file check and the retry key.
-- ---------------------------------------------------------------------------
-- p_files: [{ "key": object key, "question": question id }] for every storage ref the sanitized answers
-- keep (the Function derives it from the published schema). Outcomes: 020's (ok | gone | closed | full |
-- slot_full) plus bad_files (bad_questions names the questions). stored_id is the response's id: p_id,
-- or the one a retry with the same submit key already stored.
create or replace function public.insert_public_submission(
  p_id text, p_form_id text, p_answers jsonb, p_meta jsonb, p_files jsonb, p_submit_key uuid)
returns table (outcome text, closed_message text, full_slots jsonb, slots_left jsonb,
               bad_questions jsonb, stored_id text)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_existing text;
  v_owner text;
  v_bad jsonb;
  r record;
begin
  if p_id is null or p_form_id is null or p_answers is null or p_meta is null or p_files is null
     or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 1000 then
    raise exception 'insert_public_submission: bad arguments' using errcode = '22023';
  end if;

  -- A retry of a submit that already went through: the same answer, no second response.
  if p_submit_key is not null then
    select s.id into v_existing
      from public.submissions s
     where s.form_id = p_form_id and s.submit_key = p_submit_key;
    if found then
      return query select 'ok'::text, null::text, null::jsonb, null::jsonb, null::jsonb, v_existing;
      return;
    end if;
  end if;

  select f.owner_id into v_owner from public.forms f where f.id = p_form_id;

  if jsonb_array_length(p_files) > 0 then
    -- Lock every referenced row that exists, in key order.
    perform 1
       from public.form_uploads u
      where u.key in (select e->>'key' from jsonb_array_elements(p_files) e)
      order by u.key
        for update of u;

    with want as (
      select distinct e->>'key' as key, e->>'question' as question
        from jsonb_array_elements(p_files) e
    ), judged as (
      select w.key, w.question,
             count(*) over (partition by w.key) as uses,
             u.key is not null as has_row,
             u.form_id = p_form_id
               and (u.question_id is null or u.question_id = w.question)
               and ((u.state = 'pending' and u.created_at > now() - public.storage_pending_ttl())
                    or (u.state = 'claimed' and u.submission_id = p_id)) as row_ok
        from want w
        left join public.form_uploads u on u.key = w.key
    )
    select jsonb_agg(distinct j.question)
      into v_bad
      from judged j
     where j.key is null or j.question is null
        or j.uses > 1
        or (j.has_row and not coalesce(j.row_ok, false))
        -- No row at all: only an old page's upload under this form's own prefix, during the grace.
        or (not j.has_row and not (
              now() < public.storage_legacy_until()
              and v_owner is not null
              and j.key ~ '^(public|draft)/[A-Za-z0-9_-]{4,64}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]{1,120}$'
              and split_part(j.key, '/', 2) = p_form_id));
    if v_bad is not null then
      return query select 'bad_files'::text, null::text, null::jsonb, null::jsonb,
        (select jsonb_agg(x) from (select x from jsonb_array_elements(v_bad) x limit 50) t),
        null::text;
      return;
    end if;
  end if;

  begin
    -- 020's checks and insert, unchanged (close date, response cap, sign-up slots). The insert fires
    -- submissions_claim_uploads, which claims the rows locked above.
    select i.outcome, i.closed_message, i.full_slots, i.slots_left
      into r
      from public.insert_public_submission(p_id, p_form_id, p_answers, p_meta) i;
    if r.outcome is distinct from 'ok' then
      return query select r.outcome, r.closed_message, r.full_slots, r.slots_left,
        null::jsonb, null::text;
      return;
    end if;
    if p_submit_key is not null then
      update public.submissions s set submit_key = p_submit_key where s.id = p_id;
    end if;
  exception when unique_violation then
    -- Two copies of one retry at once: the other one stored it (this one's insert is undone).
    select s.id into v_existing
      from public.submissions s
     where s.form_id = p_form_id and s.submit_key = p_submit_key;
    if v_existing is null then
      raise;
    end if;
    return query select 'ok'::text, null::text, null::jsonb, null::jsonb, null::jsonb, v_existing;
    return;
  end;

  -- An old page's upload with no row (signed before this deploy): claimed now, bytes unknown (0) until
  -- the sweep's HEAD fills them in.
  if jsonb_array_length(p_files) > 0 then
    insert into public.form_uploads
      (key, owner_id, form_id, question_id, scope, bytes, content_type, state, submission_id,
       claimed_at, legacy)
    select distinct on (e->>'key') e->>'key', v_owner, p_form_id, null, split_part(e->>'key', '/', 1),
           0, 'application/octet-stream', 'claimed', p_id, now(), true
      from jsonb_array_elements(p_files) e
     where not exists (select 1 from public.form_uploads u where u.key = e->>'key')
    on conflict (key) do nothing;
  end if;

  return query select 'ok'::text, null::text, null::jsonb, null::jsonb, null::jsonb, p_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The sweep.
-- ---------------------------------------------------------------------------
-- Leases up to p_limit rows (at most 200) for storagesign: 'delete' (doomed at least 2 min ago, or pending
-- past the TTL) or 'head' (not checked yet, 30 min after signing). The 2 minutes let a backup restore
-- (delete, then insert again) take its files back first. With p_owner: only that owner's doomed rows,
-- at once (the studio asks right after the owner deleted something for good).
create or replace function public.storage_sweep_begin(p_limit integer, p_owner text default null)
returns table (obj_key text, obj_action text, obj_bytes bigint)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_left integer := greatest(0, least(coalesce(p_limit, 0), 200));
  v_doomed text[];
  v_expired text[];
  v_heads text[];
begin
  select coalesce(array_agg(x.key), '{}') into v_doomed
    from (select u.key from public.form_uploads u
           where u.state = 'doomed'
             and (u.owner_id = p_owner
                  or (p_owner is null and coalesce(u.doomed_at, '-infinity') <= now() - interval '2 minutes'))
             and (u.lease_until is null or u.lease_until < now())
           order by u.created_at
           limit v_left
             for update skip locked) x;
  v_left := v_left - cardinality(v_doomed);

  if p_owner is null and v_left > 0 then
    select coalesce(array_agg(x.key), '{}') into v_expired
      from (select u.key from public.form_uploads u
             where u.state = 'pending' and u.created_at <= now() - public.storage_pending_ttl()
               and (u.lease_until is null or u.lease_until < now())
             order by u.created_at
             limit v_left
               for update skip locked) x;
    v_left := v_left - cardinality(v_expired);
  end if;

  if p_owner is null and v_left > 0 then
    select coalesce(array_agg(x.key), '{}') into v_heads
      from (select u.key from public.form_uploads u
             where u.verified_at is null and u.state <> 'doomed'
               and u.created_at <= now() - interval '30 minutes'
               -- An expired pending upload is deleted, not checked.
               and not (u.state = 'pending' and u.created_at <= now() - public.storage_pending_ttl())
               and (u.lease_until is null or u.lease_until < now())
             order by u.created_at
             limit v_left
               for update skip locked) x;
  end if;

  update public.form_uploads u
     set lease_until = now() + interval '5 minutes'
   where u.key = any (v_doomed || coalesce(v_expired, '{}') || coalesce(v_heads, '{}'));

  return query
    select u.key, case when u.key = any (coalesce(v_heads, '{}')) then 'head' else 'delete' end, u.bytes
      from public.form_uploads u
     where u.key = any (v_doomed || coalesce(v_expired, '{}') || coalesce(v_heads, '{}'))
     order by 2, u.created_at;
end;
$fn$;

-- p_deleted: keys whose objects were deleted. p_heads: [{ "key", "bytes": size, or null when missing }].
-- p_again: the batch was full; open the gate again in 5 s instead of a minute.
create or replace function public.storage_sweep_finish(p_deleted text[], p_heads jsonb, p_again boolean)
returns table (deleted integer, verified integer, dropped integer)
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_deleted integer := 0;
  v_verified integer := 0;
  v_dropped integer := 0;
begin
  if p_deleted is not null and cardinality(p_deleted) > 0 then
    -- Re-checked: only rows that are still doomed or still expired.
    delete from public.form_uploads u
     where u.key = any (p_deleted)
       and (u.state = 'doomed'
            or (u.state = 'pending' and u.created_at <= now() - public.storage_pending_ttl()));
    get diagnostics v_deleted = row_count;
  end if;

  if p_heads is not null and jsonb_typeof(p_heads) = 'array' and jsonb_array_length(p_heads) > 0 then
    -- Missing and never claimed: the sign was never used. The row goes; its bytes stop counting.
    delete from public.form_uploads u
     using jsonb_array_elements(p_heads) h
     where u.key = h->>'key' and jsonb_typeof(h->'bytes') is distinct from 'number'
       and u.state = 'pending';
    get diagnostics v_dropped = row_count;
    -- Present (its real size), or missing under a response (0: nothing to count).
    update public.form_uploads u
       set verified_at = now(),
           bytes = case when jsonb_typeof(h->'bytes') = 'number'
                        then least(greatest((h->>'bytes')::numeric, 0), 1073741824)::bigint
                        else 0 end,
           lease_until = null
      from jsonb_array_elements(p_heads) h
     where u.key = h->>'key' and u.state <> 'doomed';
    get diagnostics v_verified = row_count;
  end if;

  if coalesce(p_again, false) then
    update public.storage_sweep_state s
       set next_run_at = least(s.next_run_at, now() + interval '5 seconds')
     where s.id = 1;
  end if;

  return query select v_deleted, v_verified, v_dropped;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The studio meter: the caller's own bytes, never anyone else's.
-- ---------------------------------------------------------------------------
create or replace function public.storage_quota_status()
returns table (used_bytes bigint, max_bytes bigint, pending_bytes bigint, files integer)
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  uid text := public.auth_uid();
begin
  if uid is null then
    return query select 0::bigint, public.storage_quota_limit(), 0::bigint, 0;
    return;
  end if;
  return query
  select coalesce(sum(u.bytes), 0)::bigint,
         public.storage_quota_limit(),
         coalesce(sum(u.bytes) filter (where u.state = 'pending'), 0)::bigint,
         count(*)::integer
    from public.form_uploads u
   where u.owner_id = uid
     and (u.state = 'claimed'
          or (u.state = 'pending' and u.created_at > now() - public.storage_pending_ttl()));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants: nothing for the Data API roles except the owner's own meter.
-- ---------------------------------------------------------------------------
revoke all on function public.storage_quota_limit() from public;
revoke all on function public.storage_pending_limit() from public;
revoke all on function public.storage_global_limit() from public;
revoke all on function public.storage_pending_ttl() from public;
revoke all on function public.storage_legacy_until() from public;
revoke all on function public.reserve_upload(text, text, text, text, bigint, text, boolean) from public;
revoke all on function public.upload_keys_of(jsonb) from public;
revoke all on function public.submissions_claim_uploads() from public;
revoke all on function public.submissions_doom_uploads() from public;
revoke all on function public.forms_doom_uploads() from public;
revoke all on function public.insert_public_submission(text, text, jsonb, jsonb, jsonb, uuid) from public;
revoke all on function public.storage_sweep_begin(integer, text) from public;
revoke all on function public.storage_sweep_finish(text[], jsonb, boolean) from public;
revoke all on function public.storage_quota_status() from public;
do $$ begin
  revoke all on function public.storage_quota_limit() from anonymous, authenticated;
  revoke all on function public.storage_pending_limit() from anonymous, authenticated;
  revoke all on function public.storage_global_limit() from anonymous, authenticated;
  revoke all on function public.storage_pending_ttl() from anonymous, authenticated;
  revoke all on function public.storage_legacy_until() from anonymous, authenticated;
  revoke all on function public.reserve_upload(text, text, text, text, bigint, text, boolean)
    from anonymous, authenticated;
  revoke all on function public.upload_keys_of(jsonb) from anonymous, authenticated;
  revoke all on function public.submissions_claim_uploads() from anonymous, authenticated;
  revoke all on function public.submissions_doom_uploads() from anonymous, authenticated;
  revoke all on function public.forms_doom_uploads() from anonymous, authenticated;
  revoke all on function public.insert_public_submission(text, text, jsonb, jsonb, jsonb, uuid)
    from anonymous, authenticated;
  revoke all on function public.storage_sweep_begin(integer, text) from anonymous, authenticated;
  revoke all on function public.storage_sweep_finish(text[], jsonb, boolean)
    from anonymous, authenticated;
  revoke all on function public.storage_quota_status() from anonymous;
  grant execute on function public.storage_quota_status() to authenticated;
exception when undefined_object then null; end $$;

commit;

-- Rollback (ADR-067), only after storagesign and submitresponse are back on their pre-021 builds
-- (storagesign 14 and submitresponse 11; the new ones call reserve_upload, the sweep and the 6-argument
-- insert, and answer 503 without them). Rolling the SPA back is optional: a new page's sign request is
-- also a valid old one. Objects stay in the bucket and every stored ref keeps working; only the upload
-- rows (quotas, claims, the sweep's list) and the retry keys go.
--   begin;
--   drop trigger if exists submissions_claim_uploads on public.submissions;
--   drop trigger if exists submissions_doom_uploads on public.submissions;
--   drop trigger if exists forms_doom_uploads on public.forms;
--   drop function if exists public.insert_public_submission(text, text, jsonb, jsonb, jsonb, uuid);
--   drop function if exists public.storage_quota_status();
--   drop function if exists public.storage_sweep_finish(text[], jsonb, boolean);
--   drop function if exists public.storage_sweep_begin(integer, text);
--   drop function if exists public.reserve_upload(text, text, text, text, bigint, text, boolean);
--   drop function if exists public.forms_doom_uploads();
--   drop function if exists public.submissions_doom_uploads();
--   drop function if exists public.submissions_claim_uploads();
--   drop function if exists public.upload_keys_of(jsonb);
--   drop table if exists public.storage_sweep_state;
--   drop table if exists public.form_uploads;
--   drop index if exists public.submissions_submit_key_uidx;
--   alter table public.submissions drop column if exists submit_key;
--   drop function if exists public.storage_legacy_until();
--   drop function if exists public.storage_pending_ttl();
--   drop function if exists public.storage_global_limit();
--   drop function if exists public.storage_pending_limit();
--   drop function if exists public.storage_quota_limit();
--   commit;
--   then: neonctl data-api refresh-schema
