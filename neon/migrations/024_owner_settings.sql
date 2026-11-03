-- 024_owner_settings.sql (ADR-074). Apply, then refresh the Data API schema cache
-- (`neonctl data-api refresh-schema`): the studio calls get_owner_settings / set_owner_settings.
-- Before 024 (or on a stale cache) both calls fail and the studio keeps settings on the device, as before.
--
-- What this adds:
--   owner_settings: one row per owner with their studio appearance (color mode, UI theme, studio size,
--   sounds). RLS forced, no Data API grants on the table. The only doors are the two functions below,
--   both keyed on auth_uid(), so an owner can only ever read or write their own row.
--   set_owner_settings keeps only the four known keys with known values and merges them into the row,
--   so a client can't store anything else (or anything big) in it.
begin;
set local lock_timeout = '5s';

create table if not exists public.owner_settings (
  owner_id text primary key,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint owner_settings_prefs_object check (jsonb_typeof(prefs) = 'object'),
  constraint owner_settings_prefs_size check (pg_column_size(prefs) <= 1024)
);

alter table public.owner_settings enable row level security;
alter table public.owner_settings force row level security;
revoke all on table public.owner_settings from public;
do $$ begin
  revoke all on table public.owner_settings from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists owner_settings_owner_role_all on public.owner_settings;
create policy owner_settings_owner_role_all on public.owner_settings
  for all to neondb_owner using (true) with check (true);

-- The caller's saved settings, or null when they have never saved any.
create or replace function public.get_owner_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  uid text;
begin
  uid := public.auth_uid();
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return (select s.prefs from public.owner_settings s where s.owner_id = uid);
end;
$fn$;

-- Merge the known keys of p_prefs into the caller's row; unknown keys and bad values are dropped.
-- Returns the stored settings.
create or replace function public.set_owner_settings(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid text;
  clean jsonb := '{}'::jsonb;
  saved jsonb;
begin
  uid := public.auth_uid();
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'set_owner_settings: bad arguments' using errcode = '22023';
  end if;

  if p_prefs->>'mode' in ('light', 'dark') then
    clean := clean || jsonb_build_object('mode', p_prefs->>'mode');
  end if;
  if p_prefs->>'uiTheme' in ('warm', 'neutral', 'cool') then
    clean := clean || jsonb_build_object('uiTheme', p_prefs->>'uiTheme');
  end if;
  if jsonb_typeof(p_prefs->'scale') = 'number' and p_prefs->>'scale' in ('1', '2', '3') then
    clean := clean || jsonb_build_object('scale', (p_prefs->>'scale')::int);
  end if;
  if jsonb_typeof(p_prefs->'sounds') = 'boolean' then
    clean := clean || jsonb_build_object('sounds', (p_prefs->>'sounds')::boolean);
  end if;

  insert into public.owner_settings as s (owner_id, prefs, updated_at)
  values (uid, clean, now())
  on conflict (owner_id) do update
    set prefs = s.prefs || excluded.prefs,
        updated_at = now()
  returning s.prefs into saved;

  return saved;
end;
$fn$;

do $$ begin
  revoke all on function public.get_owner_settings() from public, anonymous;
  revoke all on function public.set_owner_settings(jsonb) from public, anonymous;
  grant execute on function public.get_owner_settings() to authenticated;
  grant execute on function public.set_owner_settings(jsonb) to authenticated;
exception when undefined_object then null; end $$;

commit;

-- Rollback (the studio falls back to device-only settings when the functions are gone):
--   begin;
--   drop function if exists public.set_owner_settings(jsonb);
--   drop function if exists public.get_owner_settings();
--   drop table if exists public.owner_settings;
--   commit;
--   then: neonctl data-api refresh-schema
