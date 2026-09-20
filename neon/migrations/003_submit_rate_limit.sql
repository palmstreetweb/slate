-- Rate-limit buckets for public form submit (ADR-030).
-- Used by Neon Function `submitresponse`.

create table if not exists public.submit_rate_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  hit_count integer not null default 0
);

create index if not exists submit_rate_buckets_window_idx
  on public.submit_rate_buckets (window_started_at);

-- Atomically consume one hit. Returns whether the request is allowed.
create or replace function public.consume_submit_rate(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
returns table (
  allowed boolean,
  hit_count integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_started timestamptz;
  v_count integer;
  v_elapsed integer;
begin
  insert into public.submit_rate_buckets (bucket_key, window_started_at, hit_count)
  values (p_key, v_now, 1)
  on conflict (bucket_key) do update
    set
      window_started_at = case
        when public.submit_rate_buckets.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
        then v_now
        else public.submit_rate_buckets.window_started_at
      end,
      hit_count = case
        when public.submit_rate_buckets.window_started_at
          <= v_now - make_interval(secs => p_window_seconds)
        then 1
        else public.submit_rate_buckets.hit_count + 1
      end
  returning
    public.submit_rate_buckets.window_started_at,
    public.submit_rate_buckets.hit_count
  into v_started, v_count;

  v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_started)))::integer);

  return query
  select
    v_count <= p_max as allowed,
    v_count as hit_count,
    greatest(1, p_window_seconds - v_elapsed) as retry_after_seconds;
end;
$$;

-- Callable by the Neon Function DB role (table owner). Lock down from Data API roles.
revoke all on function public.consume_submit_rate(text, integer, integer) from public;
do $$
begin
  revoke all on function public.consume_submit_rate(text, integer, integer) from anonymous;
exception when undefined_object then null;
end $$;
do $$
begin
  revoke all on function public.consume_submit_rate(text, integer, integer) from authenticated;
exception when undefined_object then null;
end $$;