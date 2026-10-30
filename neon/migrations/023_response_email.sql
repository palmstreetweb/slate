-- 023_response_email.sql (ADR-072). Apply BEFORE deploying `notifysend`, then refresh the Data API
-- schema cache (`neonctl data-api refresh-schema`): the studio reads forms.notify_email and calls
-- set_form_notify_email. A studio on a stale cache still loads and saves; it just hides the switch.
--
-- What this adds:
--   1. forms.notify_email (off by default) and forms.notify_since. The owner turns emails on per form
--      (set_form_notify_email, or the Data API: RLS keeps it to their own rows). notify_since is the
--      database's own: a trigger sets it to now() when emails go on and clears it when they go off, so
--      turning emails on never mails about older responses, and nobody can move it back.
--   2. response_email_state: per form, how far the last email counted (notified_upto), when it went
--      out, and the backoff after a failed send. response_email_owner_day: emails per owner per UTC day.
--      Both have RLS forced and no Data API grants; only `notifysend` (the owner role) reads them.
--   3. response_emails_due: the forms with new responses whose 15-minute window has passed, with the
--      owner's verified sign-in address and today's counts. response_email_sent / response_email_failed
--      record the outcome. response_email_unsubscribe turns a form's emails off (the signed link).
--
-- Nothing on the submit path changes: `submitresponse` is not redeployed, and a submit never waits on
-- an email. The scheduled job counts submissions since notified_upto.
--
-- Advisory lock keys: 87123001 form quota (010), 87123002 AI quota (014) + slug lock (015), 87123003
-- response cap (019) + sign-up slots (020), 87123004 storage quota (021), 87123005 one notifysend run
-- at a time (held by the Function, here only for the record).
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Numbers. Change one here (create or replace), then nothing else: every check reads these.
-- ---------------------------------------------------------------------------
create or replace function public.response_email_window()
returns interval language sql immutable as $fn$ select interval '15 minutes' $fn$;
-- A response committed late can carry an earlier received_at; count only rows this much older than now.
create or replace function public.response_email_settle()
returns interval language sql immutable as $fn$ select interval '10 seconds' $fn$;
create or replace function public.response_email_owner_day_max()
returns integer language sql immutable as $fn$ select 50 $fn$;
-- Shared with sign-in mail on one Resend account: response emails must never use up its quota.
create or replace function public.response_email_day_max()
returns integer language sql immutable as $fn$ select 300 $fn$;

-- ---------------------------------------------------------------------------
-- The owner's switch.
-- ---------------------------------------------------------------------------
alter table public.forms add column if not exists notify_email boolean not null default false;
alter table public.forms add column if not exists notify_since timestamptz;

create or replace function public.forms_notify_since()
returns trigger language plpgsql set search_path = public, pg_temp as $fn$
begin
  if not new.notify_email then
    new.notify_since := null;
  elsif tg_op = 'INSERT' or not old.notify_email then
    new.notify_since := now();
  else
    new.notify_since := old.notify_since;
  end if;
  return new;
end;
$fn$;

drop trigger if exists forms_notify_since on public.forms;
create trigger forms_notify_since
  before insert or update on public.forms
  for each row execute function public.forms_notify_since();

create or replace function public.set_form_notify_email(p_form_id text, p_on boolean)
returns boolean
language plpgsql
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
  if p_on is null then
    raise exception 'set_form_notify_email: bad arguments' using errcode = '22023';
  end if;

  update public.forms f
     set notify_email = p_on
   where f.id = p_form_id
     and f.owner_id = uid
     and f.deleted_at is null;

  if not found then
    -- Same error for "not yours", "in the trash" and "does not exist".
    raise exception 'form not found' using errcode = '42501';
  end if;

  return p_on;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- What the job remembers.
-- ---------------------------------------------------------------------------
create table if not exists public.response_email_state (
  form_id text primary key references public.forms (id) on delete cascade,
  notified_upto timestamptz,
  last_sent_at timestamptz,
  fail_count integer not null default 0,
  next_try_at timestamptz
);

create table if not exists public.response_email_owner_day (
  owner_id text not null,
  day date not null,
  sent integer not null default 0,
  primary key (owner_id, day)
);

alter table public.response_email_state enable row level security;
alter table public.response_email_state force row level security;
revoke all on table public.response_email_state from public;
do $$ begin
  revoke all on table public.response_email_state from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists response_email_state_owner_role_all on public.response_email_state;
create policy response_email_state_owner_role_all on public.response_email_state
  for all to neondb_owner using (true) with check (true);

alter table public.response_email_owner_day enable row level security;
alter table public.response_email_owner_day force row level security;
revoke all on table public.response_email_owner_day from public;
do $$ begin
  revoke all on table public.response_email_owner_day from anonymous, authenticated;
exception when undefined_object then null; end $$;
drop policy if exists response_email_owner_day_owner_role_all on public.response_email_owner_day;
create policy response_email_owner_day_owner_role_all on public.response_email_owner_day
  for all to neondb_owner using (true) with check (true);

-- Finds the forms with emails on without scanning every form.
create index if not exists forms_notify_on_idx
  on public.forms (id)
  where notify_email and deleted_at is null;

-- ---------------------------------------------------------------------------
-- The job's statements.
-- ---------------------------------------------------------------------------

-- Forms due an email: emails on, not trashed, the window since the last email has passed, no backoff
-- pending, at least one new live response, and an owner whose sign-in address is verified and not
-- banned. new_count stops at 1000 (the email says "1,000+"). Ordered so a busy run is fair.
create or replace function public.response_emails_due(p_limit integer)
returns table (
  form_id text,
  owner_id text,
  owner_email text,
  form_name text,
  new_count integer,
  upto timestamptz,
  owner_sent_today integer,
  total_sent_today integer
)
language sql stable security definer set search_path = public, neon_auth, pg_temp
as $fn$
  with b as (
    select now() - public.response_email_settle() as upto,
           (now() at time zone 'utc')::date as today
  )
  select f.id,
         f.owner_id,
         lower(u.email),
         coalesce(nullif(f.published_name, ''), f.name),
         cnt.n,
         b.upto,
         coalesce(d.sent, 0),
         (select coalesce(sum(t.sent), 0)::integer
            from public.response_email_owner_day t
           where t.day = b.today)
    from public.forms f
    cross join b
    join neon_auth."user" u
      on u.id::text = f.owner_id
     and u."emailVerified" is true
     and coalesce(u.banned, false) = false
     and u.email is not null
    left join public.response_email_state s on s.form_id = f.id
    left join public.response_email_owner_day d on d.owner_id = f.owner_id and d.day = b.today
    cross join lateral (
      select count(*)::integer as n
        from (
          select 1
            from public.submissions x
           where x.form_id = f.id
             and x.deleted_at is null
             and x.received_at > greatest(f.notify_since, coalesce(s.notified_upto, f.notify_since))
             and x.received_at <= b.upto
           limit 1000
        ) capped
    ) cnt
   where f.notify_email
     and f.deleted_at is null
     and f.notify_since is not null
     and (s.last_sent_at is null or s.last_sent_at <= now() - public.response_email_window())
     and (s.next_try_at is null or s.next_try_at <= now())
     and cnt.n > 0
   order by s.last_sent_at nulls first, f.id
   limit greatest(1, least(coalesce(p_limit, 25), 100));
$fn$;

-- Sent: move the cursor, clear any backoff, count it against the owner's day.
create or replace function public.response_email_sent(
  p_form_id text, p_owner_id text, p_upto timestamptz)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
begin
  if p_form_id is null or p_owner_id is null or p_upto is null then
    raise exception 'response_email_sent: bad arguments' using errcode = '22023';
  end if;
  insert into public.response_email_state as s
         (form_id, notified_upto, last_sent_at, fail_count, next_try_at)
  values (p_form_id, p_upto, now(), 0, null)
  on conflict (form_id) do update
     set notified_upto = greatest(s.notified_upto, excluded.notified_upto),
         last_sent_at = now(),
         fail_count = 0,
         next_try_at = null;
  insert into public.response_email_owner_day as d (owner_id, day, sent)
  values (p_owner_id, (now() at time zone 'utc')::date, 1)
  on conflict (owner_id, day) do update set sent = d.sent + 1;
  -- Days older than a week are never read again.
  delete from public.response_email_owner_day where day < (now() at time zone 'utc')::date - 7;
end;
$fn$;

-- Failed: the cursor stays, so the next try still counts these responses. Back off 5, 10, 20 … minutes,
-- at most 6 hours.
create or replace function public.response_email_failed(p_form_id text)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
begin
  if p_form_id is null then
    raise exception 'response_email_failed: bad arguments' using errcode = '22023';
  end if;
  insert into public.response_email_state as s (form_id, fail_count, next_try_at)
  values (p_form_id, 1, now() + interval '5 minutes')
  on conflict (form_id) do update
     set fail_count = s.fail_count + 1,
         next_try_at = now() + least(interval '6 hours',
                                     interval '5 minutes' * power(2, least(s.fail_count, 10)));
end;
$fn$;

-- The signed unsubscribe link (the Function checks the signature first). True when emails were on.
create or replace function public.response_email_unsubscribe(p_form_id text)
returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
begin
  update public.forms set notify_email = false where id = p_form_id and notify_email;
  return found;
end;
$fn$;

revoke all on function public.forms_notify_since() from public;
revoke all on function public.set_form_notify_email(text, boolean) from public;
revoke all on function public.response_emails_due(integer) from public;
revoke all on function public.response_email_sent(text, text, timestamptz) from public;
revoke all on function public.response_email_failed(text) from public;
revoke all on function public.response_email_unsubscribe(text) from public;
do $$ begin
  revoke all on function public.forms_notify_since() from anonymous, authenticated;
  revoke all on function public.response_emails_due(integer) from anonymous, authenticated;
  revoke all on function public.response_email_sent(text, text, timestamptz)
    from anonymous, authenticated;
  revoke all on function public.response_email_failed(text) from anonymous, authenticated;
  revoke all on function public.response_email_unsubscribe(text) from anonymous, authenticated;
  revoke all on function public.set_form_notify_email(text, boolean) from anonymous;
  grant execute on function public.set_form_notify_email(text, boolean) to authenticated;
exception when undefined_object then null; end $$;

commit;

-- Rollback (nothing else reads these; the studio hides the switch when the column is gone):
--   begin;
--   drop function if exists public.response_email_unsubscribe(text);
--   drop function if exists public.response_email_failed(text);
--   drop function if exists public.response_email_sent(text, text, timestamptz);
--   drop function if exists public.response_emails_due(integer);
--   drop function if exists public.set_form_notify_email(text, boolean);
--   drop table if exists public.response_email_owner_day;
--   drop table if exists public.response_email_state;
--   drop trigger if exists forms_notify_since on public.forms;
--   drop function if exists public.forms_notify_since();
--   drop index if exists public.forms_notify_on_idx;
--   alter table public.forms drop column if exists notify_since;
--   alter table public.forms drop column if exists notify_email;
--   drop function if exists public.response_email_day_max();
--   drop function if exists public.response_email_owner_day_max();
--   drop function if exists public.response_email_settle();
--   drop function if exists public.response_email_window();
--   commit;
--   then: neonctl data-api refresh-schema
