-- Hardening pass before real users (ADR-046).
-- Apply after 012, then Data API → Refresh schema cache. No Function redeploy
-- is needed for this file alone, but 013 ships alongside the Function changes
-- in the same ADR — deploy submitresponse + storagesign too.
--
-- What this fixes (all verified against the live database on 2026-09-22):
--   1. submit_rate_buckets had no RLS and `authenticated` held select/insert/
--      update/delete on it. Any signed-in user could read respondent IPs per
--      form, reset every rate limit, or lock a specific IP out of a form.
--   2. The console's "grant public schema access" installed DEFAULT PRIVILEGES
--      that auto-grant `authenticated` on every future table and function.
--      Every migration grants explicitly, so the defaults only ever widen.
--   3. list/add/remove_team_allowlist were executable by any signed-in user
--      after 008 reduced is_psw_team() to "has a uid".
--   4. RLS was enabled but never forced; table-owner code paths bypassed it.
--   5. Rate-limit rows were never pruned.
--   6. No index served "this form's responses, newest first".

begin;

-- ---------------------------------------------------------------------------
-- 1. Rate-limit table: Functions only (they connect as the owner).
-- ---------------------------------------------------------------------------
alter table public.submit_rate_buckets enable row level security;
alter table public.submit_rate_buckets force row level security;
revoke all on table public.submit_rate_buckets from public;
do $$
begin
  revoke all on table public.submit_rate_buckets from anonymous;
exception when undefined_object then null;
end $$;
do $$
begin
  revoke all on table public.submit_rate_buckets from authenticated;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Stop auto-granting future objects to Data API roles. Explicit only.
-- ---------------------------------------------------------------------------
do $$
begin
  alter default privileges for role neondb_owner in schema public
    revoke all on tables from authenticated;
  alter default privileges for role neondb_owner in schema public
    revoke all on sequences from authenticated;
  alter default privileges for role neondb_owner in schema public
    revoke all on functions from authenticated;
exception when undefined_object then null;
end $$;
do $$
begin
  alter default privileges for role neondb_owner in schema public
    revoke all on tables from anonymous;
  alter default privileges for role neondb_owner in schema public
    revoke all on sequences from anonymous;
  alter default privileges for role neondb_owner in schema public
    revoke all on functions from anonymous;
exception when undefined_object then null;
end $$;

-- Nobody but the owner creates objects in public.
revoke create on schema public from public;
do $$
begin
  revoke create on schema public from anonymous;
  revoke create on schema public from authenticated;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Team allowlist RPCs: the SPA never calls them; nobody else should either.
-- ---------------------------------------------------------------------------
do $$
begin
  revoke all on function public.list_team_allowlist() from public, anonymous, authenticated;
  revoke all on function public.add_team_allowlist(text) from public, anonymous, authenticated;
  revoke all on function public.remove_team_allowlist(text) from public, anonymous, authenticated;
exception when undefined_object or undefined_function then null;
end $$;

-- feedback: insert-only from the app. The select grant had no policy behind it.
do $$
begin
  revoke select on table public.feedback from authenticated;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS is the last line, so make it apply to the owner role too.
-- ---------------------------------------------------------------------------
alter table public.forms force row level security;
alter table public.submissions force row level security;
alter table public.form_files force row level security;
alter table public.feedback force row level security;
alter table public.team_allowlist force row level security;
alter table public.auth_email_pending force row level security;

-- Functions and SECURITY DEFINER RPCs run as the owner and need to keep
-- working, so give the owner explicit, boring policies rather than a bypass.
drop policy if exists forms_owner_role_all on public.forms;
create policy forms_owner_role_all on public.forms
  for all to neondb_owner using (true) with check (true);
drop policy if exists submissions_owner_role_all on public.submissions;
create policy submissions_owner_role_all on public.submissions
  for all to neondb_owner using (true) with check (true);
drop policy if exists form_files_owner_role_all on public.form_files;
create policy form_files_owner_role_all on public.form_files
  for all to neondb_owner using (true) with check (true);
drop policy if exists feedback_owner_role_all on public.feedback;
create policy feedback_owner_role_all on public.feedback
  for all to neondb_owner using (true) with check (true);
drop policy if exists team_allowlist_owner_role_all on public.team_allowlist;
create policy team_allowlist_owner_role_all on public.team_allowlist
  for all to neondb_owner using (true) with check (true);
drop policy if exists auth_email_pending_owner_role_all on public.auth_email_pending;
create policy auth_email_pending_owner_role_all on public.auth_email_pending
  for all to neondb_owner using (true) with check (true);
drop policy if exists submit_rate_buckets_owner_role_all on public.submit_rate_buckets;
create policy submit_rate_buckets_owner_role_all on public.submit_rate_buckets
  for all to neondb_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5. Prune stale rate buckets opportunistically (~1 in 200 calls). No cron.
-- ---------------------------------------------------------------------------
create or replace function public.consume_submit_rate(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
returns table (
  allowed boolean,
  hit_count integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_started timestamptz;
  v_count integer;
  v_elapsed integer;
begin
  if random() < 0.005 then
    delete from public.submit_rate_buckets
    where window_started_at < v_now - interval '2 days';
  end if;

  insert into public.submit_rate_buckets (bucket_key, window_started_at, hit_count)
  values (p_key, v_now, 1)
  on conflict (bucket_key) do update
    set
      window_started_at = case
        when public.submit_rate_buckets.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
        then v_now
        else public.submit_rate_buckets.window_started_at
      end,
      hit_count = case
        when public.submit_rate_buckets.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
        then 1
        else public.submit_rate_buckets.hit_count + 1
      end
  returning
    public.submit_rate_buckets.window_started_at,
    public.submit_rate_buckets.hit_count
  into v_started, v_count;

  v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_started)))::integer);

  return query
  select
    v_count <= p_max as allowed,
    v_count as hit_count,
    greatest(1, p_window_seconds - v_elapsed) as retry_after_seconds;
end;
$$;

revoke all on function public.consume_submit_rate(text, integer, integer) from public;
do $$
begin
  revoke all on function public.consume_submit_rate(text, integer, integer) from anonymous, authenticated;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Responses page + inbox query shape.
-- ---------------------------------------------------------------------------
create index if not exists submissions_form_received_idx
  on public.submissions (form_id, received_at desc)
  where deleted_at is null;

-- OTP / magic-link rows are only useful for minutes; the auth-email Function
-- now sweeps hourly on each webhook. Clear the backlog once here.
delete from public.auth_email_pending where updated_at < now() - interval '1 hour';

commit;
