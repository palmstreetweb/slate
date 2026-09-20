-- Fix team RLS for Neon Managed Better Auth + Data API (ADR-029).
--
-- Symptoms: signed-in admin sees empty forms / "RLS check failed" while rows
-- still exist in public.forms. Cause: is_psw_team() depended on JWT email
-- claims (unreliable) and team_allowlist policies called is_psw_team()
-- (circular). Resolve membership via auth.user_id() → neon_auth.user.email.

-- Allowlist is only consulted from SECURITY DEFINER helpers — no direct client access.
revoke all on table public.team_allowlist from authenticated, anonymous;
drop policy if exists team_allowlist_psw_all on public.team_allowlist;

create or replace function public.auth_email()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  jwt_email text;
  table_email text;
  uid text;
begin
  -- Prefer JWT email when present (Neon docs include it).
  begin
    jwt_email := nullif(lower(trim(coalesce(
      auth.jwt() ->> 'email',
      auth.jwt() -> 'user_metadata' ->> 'email',
      ''
    ))), '');
  exception when others then
    jwt_email := null;
  end;
  if jwt_email is not null then
    return jwt_email;
  end if;

  -- Reliable path for Managed Better Auth: sub → neon_auth.user
  begin
    uid := nullif(auth.user_id(), '');
  exception when others then
    uid := null;
  end;
  if uid is null then
    return null;
  end if;

  select lower(u.email) into table_email
  from neon_auth."user" u
  where u.id::text = uid
  limit 1;

  return table_email;
end;
$$;

create or replace function public.is_psw_team()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  em text;
begin
  em := public.auth_email();
  if em is null then
    return false;
  end if;
  if em like '%@palmstreetweb.com' then
    return true;
  end if;
  return exists (
    select 1 from public.team_allowlist t where t.email = em
  );
end;
$$;

-- Wrap policy expression in (select ...) so Postgres treats it as an initplan
-- and avoids per-row re-evaluation / recursion footguns.
drop policy if exists forms_psw_all on public.forms;
create policy forms_psw_all on public.forms
  for all to authenticated
  using ((select public.is_psw_team()))
  with check ((select public.is_psw_team()));

drop policy if exists submissions_psw_all on public.submissions;
create policy submissions_psw_all on public.submissions
  for all to authenticated
  using ((select public.is_psw_team()))
  with check ((select public.is_psw_team()));

drop policy if exists form_files_psw_all on public.form_files;
create policy form_files_psw_all on public.form_files
  for all to authenticated
  using ((select public.is_psw_team()))
  with check ((select public.is_psw_team()));

grant execute on function public.auth_email() to authenticated, anonymous;
grant execute on function public.is_psw_team() to authenticated, anonymous;

-- Ensure the function owner can read neon_auth.user
grant usage on schema neon_auth to neondb_owner;
grant select on table neon_auth."user" to neondb_owner;
