-- Slate production schema (ADR-028). PSW team admin + public fill by slug.

-- Extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
create table public.forms (
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

create unique index forms_slug_active_uidx on public.forms (slug) where deleted_at is null;
create index forms_deleted_at_idx on public.forms (deleted_at);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------
create table public.submissions (
  id text primary key default ('s_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  form_id text not null references public.forms (id) on delete cascade,
  answers jsonb not null default '{}',
  meta jsonb not null default '{}',
  received_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index submissions_form_id_idx on public.submissions (form_id);
create index submissions_deleted_at_idx on public.submissions (deleted_at);

-- ---------------------------------------------------------------------------
-- File metadata (blobs live in Storage bucket form-uploads)
-- ---------------------------------------------------------------------------
create table public.form_files (
  id uuid primary key default gen_random_uuid(),
  form_id text not null references public.forms (id) on delete cascade,
  submission_id text references public.submissions (id) on delete set null,
  storage_path text not null,
  filename text not null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index form_files_form_id_idx on public.form_files (form_id);

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

create trigger forms_set_updated_at
before update on public.forms
for each row execute function public.set_updated_at();

create or replace function public.is_psw_team()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() ->> 'email') like '%@palmstreetweb.com',
    false
  );
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

grant execute on function public.get_form_by_slug(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.forms enable row level security;
alter table public.submissions enable row level security;
alter table public.form_files enable row level security;

-- PSW team: full access to active + trashed rows
create policy forms_psw_all on public.forms
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

create policy submissions_psw_all on public.submissions
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

create policy form_files_psw_all on public.form_files
  for all to authenticated
  using (public.is_psw_team())
  with check (public.is_psw_team());

-- Storage bucket (run via dashboard or supabase CLI)
-- insert into storage.buckets (id, name, public) values ('form-uploads', 'form-uploads', false);
