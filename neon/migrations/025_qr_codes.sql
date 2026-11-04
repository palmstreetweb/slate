-- 025_qr_codes.sql (ADR-075). Apply over the DIRECT connection string (ADR-071), then refresh the
-- Data API schema cache (`neonctl data-api refresh-schema`): the studio reads and writes qr_codes and
-- calls qr_quota_status / set_qr_target.
-- After applying: `select key from public.qr_server_key;` → Vercel env QR_SERVER_KEY (Production), then
-- redeploy. Nothing reads 025 until the QR studio ships, so applying it early changes nothing.
--
-- What this adds:
--   qr_codes          one row per QR code. Owner-scoped RLS like forms (008). kind / code / owner_id
--                     never change after insert. A dynamic code's target_url is pinned for the Data
--                     API roles: the only door is set_qr_target, which needs the server key that only
--                     /api/qr-target holds (it runs the Web Risk check first).
--   qr_scan_days      scans per code per UTC day. No IP, no device, nothing personal. Owners select.
--   retired_qr_codes  codes of permanently deleted rows, never drawn again.
--   qr_server_key     the 64-hex key for set_qr_target (the ADR-051 pattern).
--   record_qr_scan    what submitresponse runs for GET ?op=qr (table owner only).
--   Limits:           qr_quota_limit() = 100 codes per account, trash included;
--                     qr_scan_ip_hourly_max() = 500 counted scans per IP per code per hour.
--   Advisory locks:   87123006 (quota, per owner), 87123007 (code draw, per code).
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null default '',
  kind text not null,
  code text,
  target_url text,
  target_checked_at timestamptz,
  style jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint qr_codes_kind check (kind in ('static', 'dynamic')),
  constraint qr_codes_name_len check (char_length(name) <= 200),
  constraint qr_codes_code_shape check (code is null or code ~ '^[a-hjkmnp-z2-9]{8}$'),
  constraint qr_codes_kind_code check (
    (kind = 'static' and code is null and target_url is not null)
    or (kind = 'dynamic' and code is not null)
  ),
  constraint qr_codes_target check (
    target_url is null or (
      char_length(target_url) <= 2048
      and target_url ~ '^https?://[^\s/?#@]+([/?#][^\s]*)?$'
    )
  ),
  constraint qr_codes_style_object check (jsonb_typeof(style) = 'object'),
  constraint qr_codes_style_size check (octet_length(style::text) <= 122880)
);

create unique index if not exists qr_codes_code_uidx on public.qr_codes (code) where code is not null;
create index if not exists qr_codes_owner_idx on public.qr_codes (owner_id, updated_at desc);

create table if not exists public.qr_scan_days (
  code_id uuid not null references public.qr_codes (id) on delete cascade,
  day date not null,
  scans integer not null default 0 check (scans >= 0),
  primary key (code_id, day)
);

create table if not exists public.retired_qr_codes (
  code text primary key,
  owner_id text not null,
  retired_at timestamptz not null default now()
);

create table if not exists public.qr_server_key (
  id boolean primary key default true check (id),
  key text not null
);
insert into public.qr_server_key (key)
values (encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RLS + grants. Default privileges were removed in 013, so grants are explicit.
-- ---------------------------------------------------------------------------
alter table public.qr_codes enable row level security;
alter table public.qr_codes force row level security;
alter table public.qr_scan_days enable row level security;
alter table public.qr_scan_days force row level security;
alter table public.retired_qr_codes enable row level security;
alter table public.retired_qr_codes force row level security;
alter table public.qr_server_key enable row level security;
alter table public.qr_server_key force row level security;

revoke all on table public.qr_codes, public.qr_scan_days, public.retired_qr_codes,
  public.qr_server_key from public;
do $$ begin
  revoke all on table public.qr_codes, public.qr_scan_days, public.retired_qr_codes,
    public.qr_server_key from anonymous, authenticated;
  grant select, insert, update, delete on table public.qr_codes to authenticated;
  grant select on table public.qr_scan_days to authenticated;
exception when undefined_object then null; end $$;

drop policy if exists qr_codes_owner_all on public.qr_codes;
create policy qr_codes_owner_all on public.qr_codes
  for all to authenticated
  using (owner_id = (select public.auth_uid()))
  with check (owner_id = (select public.auth_uid()));

drop policy if exists qr_scan_days_owner_select on public.qr_scan_days;
create policy qr_scan_days_owner_select on public.qr_scan_days
  for select to authenticated
  using (exists (
    select 1 from public.qr_codes q
    where q.id = qr_scan_days.code_id and q.owner_id = (select public.auth_uid())
  ));

drop policy if exists qr_codes_owner_role_all on public.qr_codes;
create policy qr_codes_owner_role_all on public.qr_codes
  for all to neondb_owner using (true) with check (true);
drop policy if exists qr_scan_days_owner_role_all on public.qr_scan_days;
create policy qr_scan_days_owner_role_all on public.qr_scan_days
  for all to neondb_owner using (true) with check (true);
drop policy if exists retired_qr_codes_owner_role_all on public.retired_qr_codes;
create policy retired_qr_codes_owner_role_all on public.retired_qr_codes
  for all to neondb_owner using (true) with check (true);
drop policy if exists qr_server_key_owner_role_all on public.qr_server_key;
create policy qr_server_key_owner_role_all on public.qr_server_key
  for all to neondb_owner using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. Limits. Change the numbers here (create or replace), nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.qr_quota_limit()
returns integer language sql immutable as $$ select 100 $$;

create or replace function public.qr_scan_ip_hourly_max()
returns integer language sql immutable as $$ select 500 $$;

-- ---------------------------------------------------------------------------
-- 4. Pin trigger. Deliberately NOT security definer, so current_user is the real caller (012's rule).
--    It fires before qr_codes_enforce (triggers run in name order).
--    For the Data API roles a dynamic code's destination can't be set or changed here; the Safe
--    Browsing door (set_qr_target, security definer, so current_user is the owner role) can.
-- ---------------------------------------------------------------------------
create or replace function public.qr_codes_pin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anonymous') then
    if tg_op = 'INSERT' then
      if new.kind = 'dynamic' then
        new.target_url := null;
      end if;
      new.target_checked_at := null;
    else
      if old.kind = 'dynamic' then
        new.target_url := old.target_url;
      end if;
      new.target_checked_at := old.target_checked_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists qr_codes_a_pin on public.qr_codes;
create trigger qr_codes_a_pin
  before insert or update on public.qr_codes
  for each row execute function public.qr_codes_pin();

-- ---------------------------------------------------------------------------
-- 5. Enforce trigger (security definer: it reads retired_qr_codes and counts the owner's rows).
--    INSERT of a new id: owner from the JWT, quota, a fresh code for dynamic (client value ignored,
--    ADR-071's rule), null code for static. An upsert of an existing id passes through to UPDATE.
--    UPDATE: owner_id, kind, code and created_at never move.
-- ---------------------------------------------------------------------------
create or replace function public.qr_draw_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea;
  v_code text;
  v_i integer;
begin
  loop
    v_bytes := gen_random_bytes(8);
    v_code := '';
    for v_i in 0..7 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, v_i) % 31) + 1, 1);
    end loop;
    perform pg_advisory_xact_lock(87123007, hashtext(v_code));
    exit when not exists (select 1 from public.qr_codes q where q.code = v_code)
      and not exists (select 1 from public.retired_qr_codes r where r.code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function public.qr_codes_enforce()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid text;
  v_used integer;
  v_limit integer;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.qr_codes q where q.id = new.id) then
      -- ON CONFLICT DO UPDATE: the UPDATE branch below decides what may change.
      return new;
    end if;

    uid := public.auth_uid();
    if uid is null then
      raise exception 'not authenticated' using errcode = '42501';
    end if;
    new.owner_id := uid;

    perform pg_advisory_xact_lock(87123006, hashtext(uid));
    select count(*)::integer into v_used from public.qr_codes q where q.owner_id = uid;
    v_limit := public.qr_quota_limit();
    if v_used >= v_limit then
      raise exception 'QR_QUOTA_EXCEEDED'
        using errcode = 'P0001',
              detail = format('used=%s limit=%s', v_used, v_limit),
              hint = 'Permanently delete QR codes from Trash to make room.';
    end if;

    if new.kind = 'dynamic' then
      new.code := public.qr_draw_code();
    else
      new.code := null;
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.owner_id := old.owner_id;
  new.kind := old.kind;
  new.code := old.code;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists qr_codes_b_enforce on public.qr_codes;
create trigger qr_codes_b_enforce
  before insert or update on public.qr_codes
  for each row execute function public.qr_codes_enforce();

-- Retire on permanent delete, under the same lock the draw takes.
create or replace function public.qr_codes_retire()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.code is not null then
    perform pg_advisory_xact_lock(87123007, hashtext(old.code));
    insert into public.retired_qr_codes (code, owner_id)
    values (old.code, old.owner_id)
    on conflict (code) do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists qr_codes_retire on public.qr_codes;
create trigger qr_codes_retire
  before delete on public.qr_codes
  for each row execute function public.qr_codes_retire();

-- ---------------------------------------------------------------------------
-- 6. Owner RPCs
-- ---------------------------------------------------------------------------
create or replace function public.qr_quota_status()
returns table (used integer, quota_limit integer)
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
    return query select 0, public.qr_quota_limit();
    return;
  end if;
  return query
    select count(*)::integer, public.qr_quota_limit()
    from public.qr_codes q where q.owner_id = uid;
end;
$fn$;

-- The Safe Browsing door. /api/qr-target calls it as the owner (their bearer) plus the server key,
-- after the lookup came back clean. Returns the stored destination.
create or replace function public.set_qr_target(p_id uuid, p_url text, p_server_key text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  uid text;
  v_url text;
begin
  if p_server_key is null or not exists (
    select 1 from public.qr_server_key k
    where digest(k.key, 'sha256') = digest(p_server_key, 'sha256')
  ) then
    raise exception 'qr target: server key required' using errcode = '42501';
  end if;
  uid := public.auth_uid();
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.qr_codes q
     set target_url = p_url, target_checked_at = now()
   where q.id = p_id and q.owner_id = uid and q.kind = 'dynamic' and q.deleted_at is null
  returning q.target_url into v_url;

  if not found then
    raise exception 'qr code not found' using errcode = 'P0002';
  end if;
  return v_url;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. The scan. submitresponse (table owner) runs it for GET ?op=qr. Never blocks a hit: a code that
--    exists always resolves; p_count only decides whether this scan is counted.
--    status: 'ok' (redirect to target_url), 'inactive' (trashed, or no destination yet),
--    'not_found' (unknown or malformed; no write).
-- ---------------------------------------------------------------------------
create or replace function public.record_qr_scan(p_code text, p_ip text, p_count boolean)
returns table (status text, target_url text, counted boolean)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_target text;
  v_deleted timestamptz;
  v_allowed boolean;
begin
  if p_code is null or p_code !~ '^[a-hjkmnp-z2-9]{8}$' then
    return query select 'not_found'::text, null::text, false;
    return;
  end if;

  select q.id, q.target_url, q.deleted_at into v_id, v_target, v_deleted
  from public.qr_codes q where q.code = p_code;

  if not found then
    return query select 'not_found'::text, null::text, false;
    return;
  end if;
  if v_deleted is not null or v_target is null then
    return query select 'inactive'::text, null::text, false;
    return;
  end if;

  if not coalesce(p_count, false) or p_ip is null or p_ip = '' then
    return query select 'ok'::text, v_target, false;
    return;
  end if;

  select r.allowed into v_allowed
  from public.consume_submit_rates(
    array['qrscan:' || left(p_ip, 80) || ':' || v_id::text],
    array[3600],
    array[public.qr_scan_ip_hourly_max()],
    null
  ) r;

  if coalesce(v_allowed, false) then
    insert into public.qr_scan_days as d (code_id, day, scans)
    values (v_id, (now() at time zone 'utc')::date, 1)
    on conflict (code_id, day) do update set scans = d.scans + 1;
  end if;

  return query select 'ok'::text, v_target, coalesce(v_allowed, false);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Function grants
-- ---------------------------------------------------------------------------
revoke all on function public.qr_codes_pin() from public;
revoke all on function public.qr_codes_enforce() from public;
revoke all on function public.qr_codes_retire() from public;
revoke all on function public.qr_draw_code() from public;
revoke all on function public.record_qr_scan(text, text, boolean) from public;
revoke all on function public.qr_quota_status() from public;
revoke all on function public.set_qr_target(uuid, text, text) from public;
revoke all on function public.qr_quota_limit() from public;
revoke all on function public.qr_scan_ip_hourly_max() from public;
do $$ begin
  revoke all on function public.qr_codes_pin() from anonymous, authenticated;
  revoke all on function public.qr_codes_enforce() from anonymous, authenticated;
  revoke all on function public.qr_codes_retire() from anonymous, authenticated;
  revoke all on function public.qr_draw_code() from anonymous, authenticated;
  revoke all on function public.record_qr_scan(text, text, boolean) from anonymous, authenticated;
  revoke all on function public.qr_quota_limit() from anonymous;
  revoke all on function public.qr_scan_ip_hourly_max() from anonymous, authenticated;
  revoke all on function public.qr_quota_status() from anonymous;
  revoke all on function public.set_qr_target(uuid, text, text) from anonymous;
  grant execute on function public.qr_quota_status() to authenticated;
  grant execute on function public.set_qr_target(uuid, text, text) to authenticated;
  grant execute on function public.qr_quota_limit() to authenticated;
exception when undefined_object then null; end $$;

commit;

-- Rollback (nothing outside the QR studio reads these):
--   begin;
--   drop function if exists public.record_qr_scan(text, text, boolean);
--   drop function if exists public.set_qr_target(uuid, text, text);
--   drop function if exists public.qr_quota_status();
--   drop table if exists public.qr_scan_days;
--   drop table if exists public.qr_codes;
--   drop table if exists public.retired_qr_codes;
--   drop table if exists public.qr_server_key;
--   drop function if exists public.qr_codes_pin();
--   drop function if exists public.qr_codes_enforce();
--   drop function if exists public.qr_codes_retire();
--   drop function if exists public.qr_draw_code();
--   drop function if exists public.qr_scan_ip_hourly_max();
--   drop function if exists public.qr_quota_limit();
--   commit;
--   then: neonctl data-api refresh-schema
