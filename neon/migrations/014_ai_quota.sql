-- Build with AI daily spend cap (ADR-051).
-- Apply after 013, then Data API → Refresh schema cache. No Function redeploy.
-- /api/generate calls consume_ai_generation() before every model call and
-- fails CLOSED (503) until this file is applied — apply it before or with the
-- Vercel deploy that ships the check.
--
-- Why: the only limit on the Anthropic key was an in-memory Map per Vercel
-- instance. Cold starts and parallel instances reset it, so there was no
-- durable per-user or global ceiling on spend.
--
-- Shape: one row per (owner, UTC day) plus one '__global__' row per day. Both
-- move together, and only when both are under their caps, so a user who is
-- out of calls cannot inflate the global counter and lock everyone else out.
--
-- Only the server may spend: consume_ai_generation() requires a key that lives
-- in an owner-only table and in the Vercel env AI_QUOTA_KEY. Without it, any
-- signed-in user could call the RPC directly and a handful of throwaway
-- accounts could exhaust the global ceiling for everyone.
--
-- After pasting: run  select key from public.ai_quota_key;  and set that value
-- as AI_QUOTA_KEY on the Vercel project (Production), then redeploy.

begin;

-- ---------------------------------------------------------------------------
-- 1. Usage table: reached only through the SECURITY DEFINER RPC below.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_generation_usage (
  owner_id text not null,
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (owner_id, day)
);

alter table public.ai_generation_usage enable row level security;
alter table public.ai_generation_usage force row level security;
revoke all on table public.ai_generation_usage from public;
do $$
begin
  revoke all on table public.ai_generation_usage from anonymous;
exception when undefined_object then null;
end $$;
do $$
begin
  revoke all on table public.ai_generation_usage from authenticated;
exception when undefined_object then null;
end $$;

-- No policies for Data API roles. The owner gets the same boring policy as
-- every other table in 013 so the definer function keeps working under FORCE.
drop policy if exists ai_generation_usage_owner_role_all on public.ai_generation_usage;
create policy ai_generation_usage_owner_role_all on public.ai_generation_usage
  for all to neondb_owner using (true) with check (true);

-- Server key: generated here, readable only by the owner role.
create table if not exists public.ai_quota_key (
  id boolean primary key default true check (id),
  key text not null
);
alter table public.ai_quota_key enable row level security;
alter table public.ai_quota_key force row level security;
revoke all on table public.ai_quota_key from public;
do $$
begin
  revoke all on table public.ai_quota_key from anonymous;
  revoke all on table public.ai_quota_key from authenticated;
exception when undefined_object then null;
end $$;
drop policy if exists ai_quota_key_owner_role_all on public.ai_quota_key;
create policy ai_quota_key_owner_role_all on public.ai_quota_key
  for all to neondb_owner using (true) with check (true);
insert into public.ai_quota_key (key)
values (encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Limits. Change the numbers here (create or replace) — nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.ai_quota_limits()
returns table (
  per_user_daily integer,
  global_daily integer
)
language sql
immutable
as $$
  select 25, 500;
$$;

-- Only the definer function below reads it; nobody calls it over the Data API.
revoke all on function public.ai_quota_limits() from public;
do $$
begin
  revoke all on function public.ai_quota_limits() from anonymous;
exception when undefined_object then null;
end $$;
do $$
begin
  revoke all on function public.ai_quota_limits() from authenticated;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Take one generation for the signed-in caller, or say no.
-- ---------------------------------------------------------------------------
drop function if exists public.consume_ai_generation();

create or replace function public.consume_ai_generation(p_server_key text)
returns table (
  allowed boolean,
  used integer,
  per_user_daily integer,
  global_used integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid text;
  v_day date := (now() at time zone 'utc')::date;
  v_user_limit integer;
  v_global_limit integer;
  v_used integer;
  v_global integer;
begin
  -- Server proof first: a direct Data API call from a browser has no key.
  -- Compare digests so the check doesn't short-circuit on a shared prefix.
  if p_server_key is null or not exists (
    select 1 from public.ai_quota_key k
    where digest(k.key, 'sha256') = digest(p_server_key, 'sha256')
  ) then
    raise exception 'ai quota: server key required' using errcode = '42501';
  end if;

  select l.per_user_daily, l.global_daily
  into v_user_limit, v_global_limit
  from public.ai_quota_limits() l;

  uid := public.auth_uid();
  if uid is null or uid = '__global__' then
    -- An auth fault, not a spent quota: error so the caller fails closed (503).
    raise exception 'ai quota: not signed in' using errcode = '42501';
  end if;

  -- One lock for everyone: the global row is shared by every caller. A
  -- generate is seconds of model time, so a microsecond section never queues.
  -- The function is volatile, so each read below takes a fresh snapshot and
  -- sees the previous lock holder's committed count.
  perform pg_advisory_xact_lock(87123002, 0);

  select coalesce(max(u.count), 0) into v_used
  from public.ai_generation_usage u
  where u.owner_id = uid and u.day = v_day;

  select coalesce(max(u.count), 0) into v_global
  from public.ai_generation_usage u
  where u.owner_id = '__global__' and u.day = v_day;

  if v_used >= v_user_limit or v_global >= v_global_limit then
    return query select false, v_used, v_user_limit, v_global;
    return;
  end if;

  -- First allowed call of the UTC day sweeps anything older than 14 days.
  -- Deterministic, once a day, under the lock. No cron.
  if v_global = 0 then
    delete from public.ai_generation_usage u
    where u.day < v_day - 14;
  end if;

  insert into public.ai_generation_usage as u (owner_id, day, count)
  values (uid, v_day, 1), ('__global__', v_day, 1)
  on conflict (owner_id, day) do update
    set count = u.count + 1;

  return query select true, v_used + 1, v_user_limit, v_global + 1;
end;
$$;

revoke all on function public.consume_ai_generation(text) from public;
do $$
begin
  revoke all on function public.consume_ai_generation(text) from anonymous;
exception when undefined_object then null;
end $$;
grant execute on function public.consume_ai_generation(text) to authenticated;

commit;
