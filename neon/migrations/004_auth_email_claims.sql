-- Harden auth_email() for Managed Better Auth JWT shapes (ADR-029).
-- Empty forms list with rows still in Postgres usually means RLS saw is_psw_team()=false
-- because email wasn't resolved from the JWT / neon_auth.user fallback.

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
  jwt_email := nullif(lower(trim(coalesce(
    auth.jwt() ->> 'email',
    auth.jwt() -> 'user_metadata' ->> 'email',
    auth.jwt() -> 'app_metadata' ->> 'email',
    auth.jwt() -> 'data' ->> 'email',
    auth.jwt() ->> 'user_email',
    ''
  ))), '');
  if jwt_email is not null then
    return jwt_email;
  end if;

  begin
    uid := nullif(auth.user_id(), '');
  exception when others then
    uid := null;
  end;

  if uid is null then
    begin
      uid := nullif(auth.jwt() ->> 'sub', '');
    exception when others then
      uid := null;
    end;
  end if;

  if uid is null then
    return null;
  end if;

  begin
    select lower(u.email) into table_email
    from neon_auth."user" u
    where u.id::text = uid
    limit 1;
  exception when undefined_table or undefined_object then
    table_email := null;
  end;

  return table_email;
end;
$$;

grant execute on function public.auth_email() to authenticated;
grant execute on function public.is_psw_team() to authenticated;
