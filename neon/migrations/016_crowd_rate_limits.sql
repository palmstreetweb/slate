-- 016_crowd_rate_limits.sql (ADR-058). Apply after 015 and BEFORE redeploying submitresponse + storagesign.
-- consume_submit_rate keeps its signature and one-row result, so today's Functions and authemail keep working.
-- The one-time cleanup touches ~126 rows (all older than 25 h on 2026-09-26), so it stays in the transaction.
begin;
set local lock_timeout = '5s';

-- 1. Core: check every bucket, then charge all of them or none. A denied call writes nothing.
create or replace function public.consume_submit_rates(
  p_keys text[], p_windows integer[], p_maxes integer[], p_costs integer[] default null)
returns table (allowed boolean, denied_index integer, retry_after_seconds integer)
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_n integer := coalesce(cardinality(p_keys), 0);
  v_i integer;
  v_cost integer;
  v_started timestamptz;
  v_count integer;
  v_retry integer;
  v_worst integer := 0;
  v_worst_retry integer := 0;
begin
  -- Caller bugs fail closed and loud (the Functions answer 503).
  if v_n not between 1 and 8
     or cardinality(p_windows) is distinct from v_n
     or cardinality(p_maxes) is distinct from v_n
     or (p_costs is not null and cardinality(p_costs) is distinct from v_n) then
    raise exception 'consume_submit_rates: 1 to 8 buckets, arrays of equal length' using errcode = '22023';
  end if;
  for v_i in 1..v_n loop
    if p_windows[v_i] is null or p_windows[v_i] not between 1 and 86400 then
      raise exception 'consume_submit_rates: window must be 1..86400 s' using errcode = '22023';
    end if;
  end loop;

  -- Read-only check. Remember the bucket that blocks longest.
  for v_i in 1..v_n loop
    v_cost := coalesce(p_costs[v_i], 1);
    v_retry := 0;
    if p_keys[v_i] is null or octet_length(p_keys[v_i]) not between 1 and 256
       or p_maxes[v_i] is null or p_maxes[v_i] < 1 or v_cost < 1 or v_cost > p_maxes[v_i] then
      v_retry := p_windows[v_i];   -- refused outright, nothing written
    else
      select b.window_started_at, b.hit_count into v_started, v_count
        from public.submit_rate_buckets b where b.bucket_key = p_keys[v_i];
      if found and v_started > v_now - make_interval(secs => p_windows[v_i])
         and v_count + v_cost > p_maxes[v_i] then
        v_retry := greatest(1, p_windows[v_i] - floor(extract(epoch from (v_now - v_started)))::integer);
      end if;
    end if;
    if v_retry > v_worst_retry then v_worst := v_i; v_worst_retry := v_retry; end if;
  end loop;
  if v_worst > 0 then
    return query select false, v_worst, v_worst_retry;
    return;
  end if;

  -- Charge in one global key order (callers never deadlock each other). If a concurrent call filled
  -- a bucket since the check, the exception block undoes every charge of this call.
  begin
    for v_i in select t.i::integer from unnest(p_keys) with ordinality as t(k, i) order by t.k collate "C" loop
      v_cost := coalesce(p_costs[v_i], 1);
      insert into public.submit_rate_buckets as b (bucket_key, window_started_at, hit_count)
      values (p_keys[v_i], v_now, v_cost)
      on conflict (bucket_key) do update set
        window_started_at = case when b.window_started_at <= v_now - make_interval(secs => p_windows[v_i])
                                 then v_now else b.window_started_at end,
        hit_count = case when b.window_started_at <= v_now - make_interval(secs => p_windows[v_i])
                         then v_cost else b.hit_count + v_cost end
      returning b.window_started_at, b.hit_count into v_started, v_count;
      if v_count > p_maxes[v_i] then
        v_worst := v_i;
        v_worst_retry := greatest(1, p_windows[v_i] - floor(extract(epoch from (v_now - v_started)))::integer);
        raise exception 'rate race' using errcode = 'SR429';
      end if;
    end loop;
  exception when sqlstate 'SR429' then
    return query select false, v_worst, v_worst_retry;
    return;
  end;

  -- Deterministic, bounded prune (was random() < 0.005 over 2 days, 013:146-149). SKIP LOCKED never waits.
  -- 25 h is longer than the longest window (24 h), so a pruned row's window is already over.
  delete from public.submit_rate_buckets d
  where d.bucket_key in (
    select s.bucket_key from public.submit_rate_buckets s
    where s.window_started_at < v_now - interval '25 hours'
    order by s.window_started_at
    limit 20
    for update skip locked);

  return query select true, 0, 0;
end;
$fn$;

-- 2. One-bucket call for authemail (auth-email/index.ts:202-208) and today's Functions during rollout
--    and rollback. Same signature and one-row result; no caller reads hit_count, so it is null.
create or replace function public.consume_submit_rate(p_key text, p_window_seconds integer, p_max integer)
returns table (allowed boolean, hit_count integer, retry_after_seconds integer)
language sql volatile security definer set search_path = public
as $fn$
  select r.allowed, null::integer, r.retry_after_seconds
  from public.consume_submit_rates(array[p_key], array[p_window_seconds], array[p_max]) r;
$fn$;

-- 3. One password guess on a locked form (ADR-043, ADR-058). Ceilings, CPU guard, bcrypt and the
--    count are one transaction: no answer without the charge; an error rolls all of it back.
create or replace function public.try_fill_password(
  p_hash text, p_password text, p_ip text, p_owner text, p_form_id text,
  p_pw_max integer,        -- password attempts per IP + form owner per 10 min
  p_pw_ip_max integer,     -- password attempts per IP per 10 min
  p_fail_ip_max integer,   -- misses per IP per hour on every form; also a proven IP's cap on one form
  p_fail_form_max integer) -- misses per form per hour from every IP
returns table (ok boolean, denied text, retry_after_seconds integer)
language plpgsql volatile security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_pv text := substr(p_hash, 8, 22);   -- bcrypt salt: a new password starts fresh buckets
  v_fail_ip text := 'unlock:failip:' || p_ip;
  v_fail_form text := 'unlock:failform:' || p_form_id || ':' || v_pv;
  v_mine text := 'unlock:fail:' || p_ip || ':' || p_form_id || ':' || v_pv;
  v_proof text := 'unlock:ok:' || p_ip || ':' || p_form_id || ':' || v_pv;
  v_n_ip integer; v_n_form integer; v_n_mine integer; v_n_ok integer;
  v_at_ip timestamptz; v_at_form timestamptz; v_at_mine timestamptz;
  v_allowed boolean; v_retry integer; v_ok boolean;
begin
  if p_hash is null or p_hash !~ '^[$]2[abxy][$][0-9]{2}[$][./A-Za-z0-9]{53}$'
     or p_password is null or p_password = '' or p_ip is null or p_owner is null or p_form_id is null
     or octet_length(v_mine) > 256 or octet_length('unlock:pw:' || p_ip || ':' || p_owner) > 256
     or p_pw_max < 1 or p_pw_ip_max < 1 or p_fail_ip_max < 1 or p_fail_form_max < 1 then
    raise exception 'try_fill_password: bad arguments' using errcode = '22023';
  end if;

  -- 1. Miss ceilings, read-only: a spent budget refuses before bcrypt and writes nothing.
  select
    coalesce(max(b.hit_count) filter (where b.bucket_key = v_fail_ip), 0),
    coalesce(max(b.hit_count) filter (where b.bucket_key = v_fail_form), 0),
    coalesce(max(b.hit_count) filter (where b.bucket_key = v_mine), 0),
    coalesce(max(b.hit_count) filter (where b.bucket_key = v_proof), 0),
    max(b.window_started_at) filter (where b.bucket_key = v_fail_ip),
    max(b.window_started_at) filter (where b.bucket_key = v_fail_form),
    max(b.window_started_at) filter (where b.bucket_key = v_mine)
  into v_n_ip, v_n_form, v_n_mine, v_n_ok, v_at_ip, v_at_form, v_at_mine
  from public.submit_rate_buckets b
  where b.bucket_key in (v_fail_ip, v_fail_form, v_mine, v_proof)
    and b.window_started_at > v_now - interval '1 hour';

  -- Fewer than 3 misses by this network on this form: always gets its try.
  if v_n_mine >= 3 then
    if v_n_ok > 0 then
      -- Someone here unlocked this form this hour: only this network's own misses count.
      if v_n_mine >= p_fail_ip_max then
        return query select false, 'fail_ip', greatest(1, 3600 - floor(extract(epoch from (v_now - v_at_mine)))::integer);
        return;
      end if;
    elsif v_n_ip >= p_fail_ip_max then
      return query select false, 'fail_ip', greatest(1, 3600 - floor(extract(epoch from (v_now - v_at_ip)))::integer);
      return;
    elsif v_n_form >= p_fail_form_max then
      return query select false, 'fail_form', greatest(1, 3600 - floor(extract(epoch from (v_now - v_at_form)))::integer);
      return;
    end if;
  end if;

  -- 2. CPU guard on every password attempt, all or nothing.
  select r.allowed, r.retry_after_seconds into v_allowed, v_retry
  from public.consume_submit_rates(
    array['unlock:pw:' || p_ip || ':' || p_owner, 'unlock:pw:' || p_ip],
    array[600, 600], array[p_pw_max, p_pw_ip_max]) r;
  if not v_allowed then
    return query select false, 'pw', v_retry;
    return;
  end if;

  -- 3. The guess, then its count.
  v_ok := p_hash = crypt(normalize(p_password, NFC), p_hash);
  if v_ok then
    perform 1 from public.consume_submit_rates(array[v_proof], array[3600], array[1000000]);
  else
    perform 1 from public.consume_submit_rates(
      array[v_fail_ip, v_fail_form, v_mine], array[3600, 3600, 3600], array[1000000, 1000000, 1000000]);
  end if;
  return query select v_ok, null::text, 0;
end;
$fn$;

-- 4. set_form_fill_password: 012_fill_password.sql:46-85 verbatim, except that the password is
--    NFC-normalized (so 'café' typed on any keyboard is one password) and the minimum is 6.
--    CREATE OR REPLACE keeps its grant to authenticated (012:87-88).
create or replace function public.set_form_fill_password(p_form_id text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text;
  v_password text;
begin
  uid := public.auth_uid();
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_password := normalize(coalesce(p_password, ''), NFC);

  -- bcrypt reads at most 72 bytes; refuse longer so nothing is silently cut.
  if v_password <> '' and (char_length(v_password) < 6 or octet_length(v_password) > 72) then
    raise exception 'FILL_PASSWORD_LENGTH'
      using errcode = 'P0001',
            hint = 'Use 6 to 72 characters.';
  end if;

  update public.forms f
  set fill_password_hash = case
        when v_password = '' then null
        else crypt(v_password, gen_salt('bf', 8))
      end
  where f.id = p_form_id
    and f.owner_id = uid;

  if not found then
    -- Same error for "not yours" and "does not exist".
    raise exception 'form not found' using errcode = '42501';
  end if;

  return v_password <> '';
end;
$$;

-- 5. Grants: only the Functions' owner role runs the rate functions.
revoke all on function public.consume_submit_rates(text[], integer[], integer[], integer[]) from public;
revoke all on function public.consume_submit_rate(text, integer, integer) from public;
revoke all on function public.try_fill_password(text, text, text, text, text, integer, integer, integer, integer) from public;
do $$ begin
  revoke all on function public.consume_submit_rates(text[], integer[], integer[], integer[]) from anonymous, authenticated;
  revoke all on function public.consume_submit_rate(text, integer, integer) from anonymous, authenticated;
  revoke all on function public.try_fill_password(text, text, text, text, text, integer, integer, integer, integer) from anonymous, authenticated;
exception when undefined_object then null; end $$;

-- 6. One-time: what the random prune left behind (~126 rows today), plus any oversized key.
delete from public.submit_rate_buckets
where window_started_at < now() - interval '25 hours' or octet_length(bucket_key) > 256;
commit;
