-- Form links are fixed for life (ADR-057, audit M-SLUG-1).
-- Apply after 014. No Data API cache refresh and no Function redeploy: nothing
-- the Data API exposes changes shape.
--
-- What this fixes (reproduced on a throwaway branch on 2026-09-23):
--   1. Link takeover. The only uniqueness rule covered live forms, so trashing
--      a form freed its slug. Any signed-in account could PATCH its own form's
--      slug to it, and every scan of the printed QR opened the attacker's form.
--      The owner's Restore then failed on the clash.
--   2. No slug contract. The Data API took any text as a slug: 5,000
--      characters, markup, look-alike Unicode, or `new`, which opens the studio
--      editor at /forms/new instead of the form.
--
-- The rules after this file:
--   - A slug never changes after insert. It is kept silently, like owner_id,
--     so a stale studio save that re-sends an older draw can't fail the save.
--   - Slugs are unique across live AND trashed forms, so Restore always works.
--   - Permanently deleting a form retires its slug. Only the account that had
--     it can ever use it again (restoring its own backup); nobody else can.
--   - New forms use the studio's 8-digit slug (ADR-043). A row that re-sends
--     its own stored slug is not new, so older word slugs keep working.

begin;

-- ---------------------------------------------------------------------------
-- 1. Existing duplicates. The live-only index let a trashed form and a later
--    form share a slug. Keep the slug on the live row (else the newest) and
--    give the other rows a fresh 8-digit one. Trashed rows are never served,
--    so no working link changes. updated_at is left alone.
-- ---------------------------------------------------------------------------
alter table public.forms disable trigger forms_set_updated_at;

do $$
declare
  r record;
  candidate text;
begin
  for r in
    select ranked.id
    from (
      select f.id,
             row_number() over (
               partition by f.slug
               order by (f.deleted_at is null) desc, f.created_at desc, f.id
             ) as rn
      from public.forms f
    ) ranked
    where ranked.rn > 1
  loop
    loop
      candidate := (10000000 + floor(random() * 90000000))::bigint::text;
      exit when not exists (select 1 from public.forms f where f.slug = candidate);
    end loop;
    update public.forms set slug = candidate where id = r.id;
  end loop;
end $$;

alter table public.forms enable trigger forms_set_updated_at;

-- ---------------------------------------------------------------------------
-- 2. One row per slug, trashed rows included.
-- ---------------------------------------------------------------------------
create unique index if not exists forms_slug_uidx on public.forms (slug);
drop index if exists public.forms_slug_active_uidx;

-- ---------------------------------------------------------------------------
-- 3. Slug shape for every row: lowercase letters, digits and single hyphens,
--    at most 64 characters, never a studio route. Word slugs from before
--    ADR-043 pass; step 5 narrows new rows to 8 digits.
-- ---------------------------------------------------------------------------
alter table public.forms drop constraint if exists forms_slug_format;
alter table public.forms add constraint forms_slug_format check (
  char_length(slug) between 1 and 64
  and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and slug <> 'new'
);

-- ---------------------------------------------------------------------------
-- 4. Retired slugs. Written only by the delete trigger below; the Data API
--    roles can't read or change it.
-- ---------------------------------------------------------------------------
create table if not exists public.retired_slugs (
  slug text primary key,
  owner_id text,
  retired_at timestamptz not null default now()
);

alter table public.retired_slugs enable row level security;
alter table public.retired_slugs force row level security;
revoke all on table public.retired_slugs from public;
do $$
begin
  revoke all on table public.retired_slugs from anonymous, authenticated;
exception when undefined_object then null;
end $$;
drop policy if exists retired_slugs_owner_role_all on public.retired_slugs;
create policy retired_slugs_owner_role_all on public.retired_slugs
  for all to neondb_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5. Insert / update guard. Fires after forms_enforce_owner (triggers run in
--    name order), so new.owner_id is already the signed-in user.
--
--    Insert and delete take the same per-slug advisory lock. An insert that
--    races a permanent delete of the same slug either runs first (the row
--    still holds the slug) or waits and then sees the retired row.
-- ---------------------------------------------------------------------------
create or replace function public.forms_slug_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retired_owner text;
begin
  if tg_op = 'UPDATE' then
    new.slug := old.slug;
    return new;
  end if;

  -- INSERT. Upserts land here too, before ON CONFLICT turns them into updates.
  perform pg_advisory_xact_lock(87123002, hashtext(new.slug));

  select r.owner_id into v_retired_owner
  from public.retired_slugs r
  where r.slug = new.slug;

  if found then
    if v_retired_owner is distinct from new.owner_id then
      -- 23505 + "slug": the studio treats it like a clash and draws again.
      raise exception 'slug is retired'
        using errcode = '23505',
              detail = 'The slug of a permanently deleted form is never reused.';
    end if;
    -- The same account may bring its own slug back (restore from backup).
    return new;
  end if;

  if new.slug !~ '^[1-9][0-9]{7}$'
     and not exists (
       select 1 from public.forms f where f.id = new.id and f.slug = new.slug
     ) then
    raise exception 'invalid slug'
      using errcode = '23514',
            hint = 'New forms get an 8-digit slug (ADR-043).';
  end if;

  return new;
end;
$$;

drop trigger if exists forms_slug_lock on public.forms;
create trigger forms_slug_lock
  before insert or update on public.forms
  for each row execute function public.forms_slug_lock();

-- ---------------------------------------------------------------------------
-- 6. Retire on permanent delete. BEFORE, so the lock is taken while the row
--    still holds the slug. The first account to retire a slug keeps it.
-- ---------------------------------------------------------------------------
create or replace function public.forms_retire_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(87123002, hashtext(old.slug));
  insert into public.retired_slugs (slug, owner_id)
  values (old.slug, old.owner_id)
  on conflict (slug) do nothing;
  return old;
end;
$$;

drop trigger if exists forms_retire_slug on public.forms;
create trigger forms_retire_slug
  before delete on public.forms
  for each row execute function public.forms_retire_slug();

-- Trigger functions are never called directly.
revoke all on function public.forms_slug_lock() from public;
revoke all on function public.forms_retire_slug() from public;
do $$
begin
  revoke all on function public.forms_slug_lock() from anonymous, authenticated;
  revoke all on function public.forms_retire_slug() from anonymous, authenticated;
exception when undefined_object then null;
end $$;

commit;
