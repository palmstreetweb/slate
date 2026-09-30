-- 019_form_close.sql (ADR-063). Apply BEFORE redeploying submitresponse, then refresh the Data API
-- schema cache (`neonctl data-api refresh-schema`): the studio reads and writes the new columns.
-- A studio on a stale cache still loads and saves; it just doesn't show or change these settings.
--
-- What this adds:
--   1. Close a form on a date and time (closes_at) or after N live responses (max_responses), with an
--      optional message for people who arrive after (closed_message). Owners write them through the
--      Data API like any other form column (RLS: own rows only). They take effect at once — no
--      Republish — because the public lookup and the submit Function read them live.
--   2. tracked_sources: the owner's named flyer links (Share → Tracked links). Studio-only data; the
--      public lookup never returns it. The link itself is `/forms/{slug}?src={slug}` — nothing to look up.
--   3. submissions_form_live_idx: counts a form's live responses with an index-only scan.
--   4. insert_public_submission: the submit Function's insert. Refuses a closed form ('closed') and,
--      when a cap is set, takes a per-form advisory lock, counts, and refuses at the cap ('full'), so
--      the cap is exact under concurrent submits. Forms without a cap never take the lock.
--
-- Advisory lock keys: 87123001 form quota (010), 87123002 AI quota (014) + slug lock (015),
-- 87123003 response cap (here).
begin;
set local lock_timeout = '5s';

alter table public.forms add column if not exists closes_at timestamptz;
alter table public.forms add column if not exists max_responses integer;
alter table public.forms add column if not exists closed_message text;
alter table public.forms add column if not exists tracked_sources jsonb;

alter table public.forms drop constraint if exists forms_max_responses_range;
alter table public.forms add constraint forms_max_responses_range
  check (max_responses is null or max_responses between 1 and 10000);

alter table public.forms drop constraint if exists forms_closed_message_len;
alter table public.forms add constraint forms_closed_message_len
  check (closed_message is null or char_length(closed_message) <= 500);

alter table public.forms drop constraint if exists forms_tracked_sources_shape;
alter table public.forms add constraint forms_tracked_sources_shape
  check (
    tracked_sources is null
    or (jsonb_typeof(tracked_sources) = 'array'
        and jsonb_array_length(tracked_sources) <= 50
        and octet_length(tracked_sources::text) <= 8192)
  );

-- Live responses per form. Trashed responses don't count toward a cap, so trashing a junk response
-- frees its spot. Partial on deleted_at so the count is an index-only scan.
create index if not exists submissions_form_live_idx
  on public.submissions (form_id)
  where deleted_at is null;

create or replace function public.insert_public_submission(
  p_id text, p_form_id text, p_answers jsonb, p_meta jsonb)
returns table (outcome text, closed_message text)
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  f record;
  n integer;
begin
  if p_id is null or p_form_id is null or p_answers is null or p_meta is null then
    raise exception 'insert_public_submission: bad arguments' using errcode = '22023';
  end if;

  select fo.status, fo.deleted_at, fo.closes_at, fo.max_responses, fo.closed_message
    into f
    from public.forms fo
   where fo.id = p_form_id;
  if not found or f.deleted_at is not null or f.status <> 'published' then
    return query select 'gone'::text, null::text;
    return;
  end if;

  if f.closes_at is not null and f.closes_at <= now() then
    return query select 'closed'::text, f.closed_message;
    return;
  end if;

  if f.max_responses is not null then
    -- One submit at a time per capped form, so N concurrent submits at count = cap - 1 store one.
    -- Released at commit, after the insert is visible, so the next holder counts it.
    perform pg_advisory_xact_lock(87123003, hashtext(p_form_id));
    select count(*) into n
      from public.submissions s
     where s.form_id = p_form_id and s.deleted_at is null;
    if n >= f.max_responses then
      return query select 'full'::text, f.closed_message;
      return;
    end if;
  end if;

  insert into public.submissions (id, form_id, answers, meta, received_at)
  values (p_id, p_form_id, p_answers, p_meta, now());
  return query select 'ok'::text, null::text;
end;
$fn$;

revoke all on function public.insert_public_submission(text, text, jsonb, jsonb) from public;
do $$ begin
  revoke all on function public.insert_public_submission(text, text, jsonb, jsonb)
    from anonymous, authenticated;
exception when undefined_object then null; end $$;

commit;

-- Rollback (ADR-063), only after submitresponse is back on its pre-019 build (it calls
-- insert_public_submission and reads the new columns). Settings are lost; responses are untouched.
--   begin;
--   drop function if exists public.insert_public_submission(text, text, jsonb, jsonb);
--   drop index if exists public.submissions_form_live_idx;
--   alter table public.forms drop constraint if exists forms_tracked_sources_shape;
--   alter table public.forms drop constraint if exists forms_closed_message_len;
--   alter table public.forms drop constraint if exists forms_max_responses_range;
--   alter table public.forms drop column if exists tracked_sources;
--   alter table public.forms drop column if exists closed_message;
--   alter table public.forms drop column if exists max_responses;
--   alter table public.forms drop column if exists closes_at;
--   commit;
--   then: neonctl data-api refresh-schema
