-- Extra team emails beyond @palmstreetweb.com (testers, contractors).
-- Add rows: insert into public.team_allowlist (email) values ('buddy@gmail.com');
-- Apply after 001_initial.sql, then refresh Data API schema cache.

create table if not exists public.team_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.team_allowlist enable row level security;

drop policy if exists team_allowlist_psw_all on public.team_allowlist;
create policy team_allowlist_psw_all on public.team_allowlist
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

-- Re-create is_psw_team now that team_allowlist exists (001 defines a stub-safe version).
create or replace function public.is_psw_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.auth_email() like '%@palmstreetweb.com'
    or exists (
      select 1 from public.team_allowlist t
      where t.email = public.auth_email()
    ),
    false
  );
$$;

-- Pre-auth check for magic-link login (anon can call; returns only true/false).
create or replace function public.can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(p_email)) like '%@palmstreetweb.com'
    or exists (
      select 1 from public.team_allowlist t
      where t.email = lower(trim(p_email))
    );
$$;

grant execute on function public.can_sign_in(text) to anonymous, authenticated;
grant select, insert, update, delete on public.team_allowlist to authenticated;
