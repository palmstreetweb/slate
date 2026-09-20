-- Team allowlist management RPCs for Settings UI (ADR-035).
--
-- Keep direct table access revoked (005) to avoid RLS ↔ is_psw_team() cycles.
-- Team members manage rows only through SECURITY DEFINER helpers that gate on
-- is_psw_team() first. Apply after 006, then refresh Data API schema cache.

create or replace function public.list_team_allowlist()
returns table (email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_psw_team() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select t.email, t.created_at
    from public.team_allowlist t
    order by t.created_at asc, t.email asc;
end;
$$;

create or replace function public.add_team_allowlist(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  if not public.is_psw_team() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  em := lower(trim(coalesce(p_email, '')));
  if em = '' or position('@' in em) = 0 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  -- Domain members already have access; skip cluttering the list.
  if em like '%@palmstreetweb.com' then
    return em;
  end if;

  insert into public.team_allowlist (email)
  values (em)
  on conflict (email) do nothing;

  return em;
end;
$$;

create or replace function public.remove_team_allowlist(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  me text;
  deleted int;
begin
  if not public.is_psw_team() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  em := lower(trim(coalesce(p_email, '')));
  if em = '' then
    raise exception 'Email required.' using errcode = '22023';
  end if;

  me := public.auth_email();
  -- Don't let allowlisted-only users lock themselves out.
  if me is not null
     and me = em
     and me not like '%@palmstreetweb.com' then
    raise exception 'You cannot remove your own email.' using errcode = '22023';
  end if;

  delete from public.team_allowlist t where t.email = em;
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke all on function public.list_team_allowlist() from public, anonymous;
revoke all on function public.add_team_allowlist(text) from public, anonymous;
revoke all on function public.remove_team_allowlist(text) from public, anonymous;

grant execute on function public.list_team_allowlist() to authenticated;
grant execute on function public.add_team_allowlist(text) to authenticated;
grant execute on function public.remove_team_allowlist(text) to authenticated;

-- Still no direct client table access (005).
revoke all on table public.team_allowlist from authenticated, anonymous;
