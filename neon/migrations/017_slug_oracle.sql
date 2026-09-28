-- 017_slug_oracle.sql (ADR-061). Apply after 016 and BEFORE redeploying submitresponse.
-- No Data API cache refresh: nothing the Data API exposes changes shape (get_form_by_slug keeps its
-- signature and grants; the new table and function are not granted to Data API roles).
--
-- What this fixes:
--   1. slug-oracle. get_form_by_slug (012) is an anonymous, unthrottled Data API RPC, so a script can
--      walk the 8-digit slug space. The Data API can't see a trustworthy client IP, so the throttled
--      lookup moves to submitresponse (GET ?op=form&slug=), which can: lookup_public_form below charges
--      DISTINCT unknown slugs per IP and, once an IP is over budget, refuses hits too.
--   2. Live-name leak. get_form_by_slug returned the live forms.name, even for locked forms, so a rename
--      after publishing reached every scanner. forms.published_name is the name as of the last publish.
--
-- Anonymous EXECUTE on get_form_by_slug stays for the old-bundle overlap; 018 revokes it (ADR-061).
begin;
set local lock_timeout = '5s';

-- 1. The published title: forms.name as of the last publish.
alter table public.forms add column if not exists published_name text;

-- Backfill: live forms get today's name, which is exactly what they serve today (nothing new is
-- revealed). updated_at is left alone (015 did the same).
alter table public.forms disable trigger forms_set_updated_at;
update public.forms
   set published_name = name
 where published_schema is not null and published_name is null;
alter table public.forms enable trigger forms_set_updated_at;

-- Snapshot on publish, pinned otherwise. The studio publishes with an upsert that sets
-- published_schema = schema and status = 'published' (formsRemote.publishFormRemote), and every
-- other save re-sends the same published_schema, so "published_schema changed, or status became
-- published" is exactly "the author pressed Publish or Republish". Any client-sent published_name is
-- ignored, for every role.
create or replace function public.forms_published_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- A restored backup brings its published schema back under its own name.
    new.published_name := case when new.published_schema is not null then new.name end;
  elsif new.published_schema is distinct from old.published_schema
        or (new.status = 'published' and old.status is distinct from 'published') then
    new.published_name := case when new.published_schema is not null then new.name end;
  else
    new.published_name := old.published_name;
  end if;
  return new;
end;
$$;

drop trigger if exists forms_published_name on public.forms;
create trigger forms_published_name
  before insert or update on public.forms
  for each row execute function public.forms_published_name();

-- 2. Distinct misses per IP. One row per IP: the window start and the int4 hashes of the unknown slugs
--    it asked for in that window (at most p_miss_max of them, ~1.2 KB at 300). A repeat of the same
--    unknown slug is free, so 300 people scanning one dead QR, or one person reloading, count once.
create table if not exists public.slug_miss_buckets (
  ip_key text primary key check (octet_length(ip_key) between 1 and 200),
  window_started_at timestamptz not null,
  misses integer[] not null default '{}'
);
create index if not exists slug_miss_buckets_started_idx on public.slug_miss_buckets (window_started_at);

alter table public.slug_miss_buckets enable row level security;
alter table public.slug_miss_buckets force row level security;
revoke all on table public.slug_miss_buckets from public;
do $$ begin
  revoke all on table public.slug_miss_buckets from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists slug_miss_buckets_owner_role_all on public.slug_miss_buckets;
create policy slug_miss_buckets_owner_role_all on public.slug_miss_buckets
  for all to neondb_owner using (true) with check (true);

-- 3. The throttled lookup (submitresponse: op=form and op=unlock). One statement.
--    outcome 'denied': this IP has p_miss_max distinct misses in the window. Refused before the form
--                      is read, hits included (else the oracle survives). Writes nothing.
--    outcome 'ok':     published, not trashed, has a schema. Writes nothing. schema is null when locked.
--    outcome 'miss':   anything else (unknown, draft, trashed). Charges one distinct miss.
--    owner_id and fill_password_hash are for the Function only; it never sends them to a browser.
create or replace function public.lookup_public_form(
  p_slug text, p_ip text, p_miss_max integer, p_window_seconds integer default 600)
returns table (
  outcome text, retry_after_seconds integer,
  id text, name text, slug text, owner_id text, fill_password_hash text, published_schema jsonb)
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_hash integer := hashtext(p_slug);
  v_started timestamptz;
  v_misses integer[];
  v_live boolean;
  f record;
begin
  -- Caller bugs fail closed and loud (the Function answers 503).
  if p_slug is null or octet_length(p_slug) not between 1 and 64
     or p_ip is null or octet_length(p_ip) not between 1 and 200
     or p_miss_max is null or p_miss_max < 1
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'lookup_public_form: bad arguments' using errcode = '22023';
  end if;

  select b.window_started_at, b.misses into v_started, v_misses
    from public.slug_miss_buckets b where b.ip_key = p_ip;
  v_live := found and v_started > v_now - make_interval(secs => p_window_seconds);

  if v_live and cardinality(v_misses) >= p_miss_max then
    return query select 'denied'::text,
      greatest(1, p_window_seconds - floor(extract(epoch from (v_now - v_started)))::integer),
      null::text, null::text, null::text, null::text, null::text, null::jsonb;
    return;
  end if;

  select fo.id, fo.slug, fo.owner_id, fo.fill_password_hash, fo.published_schema,
         -- published_name is set for every published row (backfill + trigger); the brand name from
         -- the same published snapshot is a fallback that is never the live name.
         coalesce(fo.published_name, fo.published_schema->'brand'->>'name', 'Form') as pname
    into f
    from public.forms fo
   where fo.slug = p_slug and fo.deleted_at is null and fo.status = 'published'
     and fo.published_schema is not null
   limit 1;
  if found then
    return query select 'ok'::text, 0, f.id, f.pname, f.slug, f.owner_id, f.fill_password_hash,
      case when f.fill_password_hash is null then f.published_schema end;
    return;
  end if;

  -- A miss. Repeats in the window are free and write nothing.
  if not (v_live and v_hash = any(v_misses)) then
    insert into public.slug_miss_buckets as b (ip_key, window_started_at, misses)
    values (p_ip, v_now, array[v_hash])
    on conflict (ip_key) do update set
      window_started_at = case when b.window_started_at <= v_now - make_interval(secs => p_window_seconds)
                               then v_now else b.window_started_at end,
      misses = case when b.window_started_at <= v_now - make_interval(secs => p_window_seconds)
                      then array[v_hash]
                    when v_hash = any(b.misses) or cardinality(b.misses) >= p_miss_max
                      then b.misses
                    else b.misses || v_hash end;

    -- Bounded prune on the write path only (hits never write). SKIP LOCKED never waits.
    delete from public.slug_miss_buckets d
     where d.ip_key in (
       select s.ip_key from public.slug_miss_buckets s
        where s.window_started_at < v_now - interval '25 hours'
        order by s.window_started_at
        limit 20
        for update skip locked);
  end if;

  return query select 'miss'::text, 0,
    null::text, null::text, null::text, null::text, null::text, null::jsonb;
end;
$fn$;

revoke all on function public.lookup_public_form(text, text, integer, integer) from public;
do $$ begin
  revoke all on function public.lookup_public_form(text, text, integer, integer) from anonymous, authenticated;
exception when undefined_object then null; end $$;
revoke all on function public.forms_published_name() from public;
do $$ begin
  revoke all on function public.forms_published_name() from anonymous, authenticated;
exception when undefined_object then null; end $$;

-- 4. Old bundles (overlap window only): same signature and grants, but the published title instead of
--    the live name. CREATE OR REPLACE keeps 012's grants; 018 revokes them.
create or replace function public.get_form_by_slug(p_slug text)
returns table (
  id text,
  name text,
  slug text,
  locked boolean,
  schema jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    coalesce(f.published_name, f.published_schema->'brand'->>'name', 'Form'),
    f.slug,
    f.fill_password_hash is not null as locked,
    case when f.fill_password_hash is null then f.published_schema else null end as schema
  from public.forms f
  where f.slug = p_slug
    and f.deleted_at is null
    and f.status = 'published'
    and f.published_schema is not null;
$$;

commit;

-- Rollback (ADR-061), only after submitresponse is back on its pre-8b build (its unlock reads
-- lookup_public_form). Restores 012's get_form_by_slug body, which serves the live forms.name again.
--   begin;
--   drop trigger if exists forms_published_name on public.forms;
--   drop function if exists public.forms_published_name();
--   drop function if exists public.lookup_public_form(text, text, integer, integer);
--   drop table if exists public.slug_miss_buckets;
--   create or replace function public.get_form_by_slug(p_slug text)
--   returns table (id text, name text, slug text, locked boolean, schema jsonb)
--   language sql stable security definer set search_path = public as $$
--     select f.id, f.name, f.slug, f.fill_password_hash is not null,
--            case when f.fill_password_hash is null then f.published_schema end
--     from public.forms f
--     where f.slug = p_slug and f.deleted_at is null and f.status = 'published'
--       and f.published_schema is not null;
--   $$;
--   alter table public.forms drop column if exists published_name;
--   commit;
