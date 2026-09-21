-- Studio feedback notes (signed-in users). Read in Neon SQL; not shown in the app.

create table if not exists public.feedback (
  id text primary key default ('fb_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  owner_id text,
  email text,
  message text not null,
  path text,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (owner_id = (select public.auth_uid()));

grant select, insert on public.feedback to authenticated;
