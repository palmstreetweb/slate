-- Harden team gate for Neon Managed Better Auth (ADR-029).
--
-- Intermittent "Signed in, but team access was denied" happens when JWT email
-- claims are missing and neon_auth.user lookup misses on id format. Expand
-- claim paths + id matching. Apply after 005, then refresh Data API schema cache.

create or replace function public.auth_email()
returns text
language plpgsql
stable
security definer
set search_path = public, neon_auth
as $$
declare
  claims jsonb;
  jwt_email text;
  table_email text;
  uid text;
begin
  begin
    claims := auth.jwt();
  exception when others then
    claims := null;
  end;

  if claims is not null then
    jwt_email := nullif(lower(trim(coalesce(
      claims ->> 'email',
      claims -> 'user_metadata' ->> 'email',
      claims -> 'app_metadata' ->> 'email',
      claims -> 'data' ->> 'email',
      claims -> 'user' ->> 'email',
      claims -> 'session' ->> 'email',
      claims ->> 'user_email',
      claims ->> 'preferred_username',
      ''
    ))), '');
    if jwt_email is not null and jwt_email like '%@%' then
      return jwt_email;
    end if;
  end if;

  begin
    uid := nullif(auth.user_id(), '');
  exception when others then
    uid := null;
  end;

  if uid is null and claims is not null then
    uid := nullif(coalesce(claims ->> 'sub', claims ->> 'id', ''), '');
  end if;

  if uid is null then
    return null;
  end if;

  begin
    select lower(u.email) into table_email
    from neon_auth."user" u
    where u.id::text = uid
       or u.id::text = replace(uid, '-', '')
       or (uid ~* '^[0-9a-f-]{36}$' and u.id = uid::uuid)
    limit 1;
  exception when others then
    table_email := null;
  end;

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
  if em is null or em = '' then
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

grant execute on function public.auth_email() to authenticated, anonymous;
grant execute on function public.is_psw_team() to authenticated, anonymous;

-- Function owner must read neon_auth.user for the fallback path.
do $$
begin
  grant usage on schema neon_auth to current_user;
  grant select on table neon_auth."user" to current_user;
exception when others then
  raise notice 'neon_auth grants skipped: %', sqlerrm;
end;
$$;
