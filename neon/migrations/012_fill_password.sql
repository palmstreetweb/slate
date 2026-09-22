-- Optional public-fill password lock (ADR-043).
-- Same slug / QR. The hash never leaves Postgres + Neon Functions.
-- Apply after 011, then refresh Data API schema cache, then redeploy
-- submitresponse + storagesign.

begin;

alter table public.forms
  add column if not exists fill_password_hash text;

-- Owner SPA reads this instead of the hash.
alter table public.forms
  add column if not exists fill_locked boolean
  generated always as (fill_password_hash is not null) stored;

-- ---------------------------------------------------------------------------
-- Data API roles can never set, change, or clear the hash. Only the
-- SECURITY DEFINER RPC below (runs as the function owner) may write it.
-- Deliberately NOT security definer so current_user is the real caller.
-- ---------------------------------------------------------------------------
create or replace function public.forms_guard_fill_password()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anonymous') then
    if tg_op = 'INSERT' then
      new.fill_password_hash := null;
    else
      new.fill_password_hash := old.fill_password_hash;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forms_guard_fill_password on public.forms;
create trigger forms_guard_fill_password
  before insert or update on public.forms
  for each row execute function public.forms_guard_fill_password();

-- ---------------------------------------------------------------------------
-- Owner-only: set / change / clear the fill password. Empty string clears.
-- Returns the new locked state.
-- ---------------------------------------------------------------------------
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

  v_password := coalesce(p_password, '');

  -- bcrypt reads at most 72 bytes; refuse longer so nothing is silently cut.
  if v_password <> '' and (char_length(v_password) < 4 or octet_length(v_password) > 72) then
    raise exception 'FILL_PASSWORD_LENGTH'
      using errcode = 'P0001',
            hint = 'Use 4 to 72 characters.';
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

revoke all on function public.set_form_fill_password(text, text) from public;
grant execute on function public.set_form_fill_password(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Public fetch by slug: locked forms return the name only. The schema comes
-- from the submit-response Function after a successful unlock.
-- Return type changes, so drop + recreate (001 is left untouched).
-- ---------------------------------------------------------------------------
drop function if exists public.get_form_by_slug(text);

create function public.get_form_by_slug(p_slug text)
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
    f.name,
    f.slug,
    f.fill_password_hash is not null as locked,
    case when f.fill_password_hash is null then f.published_schema else null end as schema
  from public.forms f
  where f.slug = p_slug
    and f.deleted_at is null
    and f.status = 'published'
    and f.published_schema is not null;
$$;

revoke all on function public.get_form_by_slug(text) from public;
grant execute on function public.get_form_by_slug(text) to anonymous, authenticated;

commit;
