-- Extra team emails beyond @palmstreetweb.com (testers, contractors).
-- Add rows: insert into public.team_allowlist (email) values ('buddy@gmail.com');

create table if not exists public.team_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.team_allowlist enable row level security;

create policy team_allowlist_psw_all on public.team_allowlist
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

create or replace function public.is_psw_team()
returns boolean
language sql
stable
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') like '%@palmstreetweb.com'
    or exists (
      select 1 from public.team_allowlist t
      where t.email = lower(auth.jwt() ->> 'email')
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

grant execute on function public.can_sign_in(text) to anon, authenticated;
