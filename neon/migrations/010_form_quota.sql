-- Hard per-user form cap (ADR-038).
-- Counts every row for the owner, including trash. Permanent delete frees a slot.
-- Apply after 009, then refresh Data API schema cache.

create or replace function public.form_quota_limit()
returns integer
language sql
immutable
as $$
  select 50;
$$;

create or replace function public.form_quota_status()
returns table (
  used integer,
  max_forms integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid text;
begin
  uid := public.auth_uid();
  if uid is null then
    return query select 0, public.form_quota_limit();
    return;
  end if;
  return query
  select count(*)::integer, public.form_quota_limit()
  from public.forms
  where owner_id = uid;
end;
$$;

revoke all on function public.form_quota_limit() from public;
revoke all on function public.form_quota_status() from public;
grant execute on function public.form_quota_limit() to authenticated, anonymous;
grant execute on function public.form_quota_status() to authenticated;

-- Stamp owner + reject inserts at the cap. Upserts of an existing id skip the
-- quota so editor saves still work when the library is full.
create or replace function public.forms_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text;
  v_used integer;
  v_limit integer;
begin
  uid := public.auth_uid();

  if tg_op = 'INSERT' then
    if uid is null then
      raise exception 'not authenticated' using errcode = '42501';
    end if;
    -- Always bind to the signed-in user (ignore client-supplied owner_id).
    new.owner_id := uid;

    -- ON CONFLICT UPDATE still fires BEFORE INSERT. Don't block edits.
    if exists (select 1 from public.forms f where f.id = new.id) then
      return new;
    end if;

    -- Serialize two tabs / two API calls creating at the same time.
    perform pg_advisory_xact_lock(87123001, hashtext(uid));

    select count(*)::integer into v_used
    from public.forms
    where owner_id = uid;

    v_limit := public.form_quota_limit();
    if v_used >= v_limit then
      raise exception 'FORM_QUOTA_EXCEEDED'
        using errcode = 'P0001',
              detail = format('used=%s limit=%s', v_used, v_limit),
              hint = 'Permanently delete forms from Trash to make room.';
    end if;

    return new;
  end if;

  -- UPDATE: never transfer ownership via the Data API.
  new.owner_id := old.owner_id;
  return new;
end;
$$;
