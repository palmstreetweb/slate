-- Open signup + per-user form ownership (ADR-036).
-- Anyone with Neon Auth can use Slate; each user only sees their own forms.
-- Apply after 007, then refresh Data API schema cache.

-- ---------------------------------------------------------------------------
-- Owner column
-- ---------------------------------------------------------------------------
alter table public.forms
  add column if not exists owner_id text;

create index if not exists forms_owner_id_idx on public.forms (owner_id);

-- Prefer a known PSW account for existing shared-library rows; else first auth user.
do $$
declare
  uid text;
begin
  select u.id::text into uid
  from neon_auth."user" u
  where lower(u.email) in (
    'caleb@palmstreetweb.com',
    'cabtion@gmail.com',
    'cabtiononline@gmail.com'
  )
  order by case lower(u.email)
    when 'caleb@palmstreetweb.com' then 1
    when 'cabtion@gmail.com' then 2
    else 3
  end
  limit 1;

  if uid is null then
    select u.id::text into uid
    from neon_auth."user" u
    order by u."createdAt" asc nulls last
    limit 1;
  end if;

  if uid is not null then
    update public.forms
    set owner_id = uid
    where owner_id is null or owner_id = '';
  end if;
exception when undefined_table or undefined_object then
  raise notice 'neon_auth.user missing — leave owner_id for trigger backfill';
end;
$$;

-- ---------------------------------------------------------------------------
-- auth.user_id() helper (stable for RLS / triggers)
-- ---------------------------------------------------------------------------
create or replace function public.auth_uid()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid text;
  claims jsonb;
begin
  begin
    uid := nullif(auth.user_id(), '');
  exception when others then
    uid := null;
  end;

  if uid is null then
    begin
      claims := auth.jwt();
    exception when others then
      claims := null;
    end;
    if claims is not null then
      uid := nullif(coalesce(claims ->> 'sub', claims ->> 'id', ''), '');
    end if;
  end if;

  return uid;
end;
$$;

grant execute on function public.auth_uid() to authenticated, anonymous;

-- ---------------------------------------------------------------------------
-- Stamp owner on insert; freeze owner on update
-- ---------------------------------------------------------------------------
create or replace function public.forms_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text;
begin
  uid := public.auth_uid();

  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'not authenticated' using errcode = '42501';
    end if;
    -- Always bind to the signed-in user (ignore client-supplied owner_id).
    new.owner_id := uid;
    return new;
  end if;

  -- UPDATE: never transfer ownership via the Data API.
  new.owner_id := old.owner_id;
  return new;
end;
$$;

drop trigger if exists forms_enforce_owner on public.forms;
create trigger forms_enforce_owner
before insert or update on public.forms
for each row execute function public.forms_enforce_owner();

-- ---------------------------------------------------------------------------
-- Open signup gate (magic-link pre-check)
-- ---------------------------------------------------------------------------
create or replace function public.can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select length(trim(coalesce(p_email, ''))) > 3
    and position('@' in trim(p_email)) > 1;
$$;

grant execute on function public.can_sign_in(text) to anonymous, authenticated;

-- is_psw_team kept for older clients: true for any authenticated user.
create or replace function public.is_psw_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_uid() is not null;
$$;

grant execute on function public.is_psw_team() to authenticated, anonymous;

-- ---------------------------------------------------------------------------
-- Owner-scoped RLS
-- ---------------------------------------------------------------------------
drop policy if exists forms_psw_all on public.forms;
drop policy if exists forms_owner_all on public.forms;
create policy forms_owner_all on public.forms
  for all to authenticated
  using (owner_id = (select public.auth_uid()))
  with check (owner_id = (select public.auth_uid()));

drop policy if exists submissions_psw_all on public.submissions;
drop policy if exists submissions_owner_all on public.submissions;
create policy submissions_owner_all on public.submissions
  for all to authenticated
  using (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.owner_id = (select public.auth_uid())
    )
  )
  with check (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.owner_id = (select public.auth_uid())
    )
  );

drop policy if exists form_files_psw_all on public.form_files;
drop policy if exists form_files_owner_all on public.form_files;
create policy form_files_owner_all on public.form_files
  for all to authenticated
  using (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.owner_id = (select public.auth_uid())
    )
  )
  with check (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.owner_id = (select public.auth_uid())
    )
  );

-- Public fill + anonymous submit path unchanged (SECURITY DEFINER / Functions).

-- Team allowlist RPCs remain but are unused by the SPA (ADR-035 superseded).
-- Direct table access stays revoked.
revoke all on table public.team_allowlist from authenticated, anonymous;
