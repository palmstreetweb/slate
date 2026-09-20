-- Slate production schema on Neon (ADR-029). PSW team admin + public fill by slug.
-- Apply in Neon SQL Editor, then refresh Data API schema cache.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
create table if not exists public.forms (
  id text primary key default ('f_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  name text not null,
  slug text not null,
  schema jsonb not null,
  published_schema jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists forms_slug_active_uidx on public.forms (slug) where deleted_at is null;
create index if not exists forms_deleted_at_idx on public.forms (deleted_at);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------
create table if not exists public.submissions (
  id text primary key default ('s_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  form_id text not null references public.forms (id) on delete cascade,
  answers jsonb not null default '{}',
  meta jsonb not null default '{}',
  received_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists submissions_form_id_idx on public.submissions (form_id);
create index if not exists submissions_deleted_at_idx on public.submissions (deleted_at);

-- ---------------------------------------------------------------------------
-- File metadata (blobs live in Neon Object Storage bucket form-uploads)
-- ---------------------------------------------------------------------------
create table if not exists public.form_files (
  id uuid primary key default gen_random_uuid(),
  form_id text not null references public.forms (id) on delete cascade,
  submission_id text references public.submissions (id) on delete set null,
  storage_path text not null,
  filename text not null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists form_files_form_id_idx on public.form_files (form_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forms_set_updated_at on public.forms;
create trigger forms_set_updated_at
before update on public.forms
for each row execute function public.set_updated_at();

-- Email from Managed Better Auth JWT (preferred). neon_auth.user is a fallback
-- when Auth schema exists; wrapped so SQL still applies before Auth is enabled.
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
begin
  jwt_email := nullif(lower(coalesce(
    auth.jwt() ->> 'email',
    auth.jwt() -> 'user_metadata' ->> 'email',
    ''
  )), '');
  if jwt_email is not null then
    return jwt_email;
  end if;
  begin
    select lower(u.email) into table_email
    from neon_auth."user" u
    where u.id::text = auth.user_id()
    limit 1;
  exception when undefined_table or undefined_object then
    table_email := null;
  end;
  return table_email;
end;
$$;

-- Allowlist extended in 002_team_allowlist.sql
create or replace function public.is_psw_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_email() like '%@palmstreetweb.com', false);
$$;

-- ---------------------------------------------------------------------------
-- Public: fetch published form by slug (no auth)
-- ---------------------------------------------------------------------------
create or replace function public.get_form_by_slug(p_slug text)
returns table (
  id text,
  name text,
  slug text,
  schema jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.slug, f.published_schema as schema
  from public.forms f
  where f.slug = p_slug
    and f.deleted_at is null
    and f.status = 'published'
    and f.published_schema is not null;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.forms enable row level security;
alter table public.submissions enable row level security;
alter table public.form_files enable row level security;

drop policy if exists forms_psw_all on public.forms;
create policy forms_psw_all on public.forms
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

drop policy if exists submissions_psw_all on public.submissions;
create policy submissions_psw_all on public.submissions
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

drop policy if exists form_files_psw_all on public.form_files;
create policy form_files_psw_all on public.form_files
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

-- Data API roles (safe if already granted by Console "Grant public schema access")
grant usage on schema public to authenticated, anonymous;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.get_form_by_slug(text) to anonymous, authenticated;
grant execute on function public.auth_email() to authenticated;
grant execute on function public.is_psw_team() to authenticated;
