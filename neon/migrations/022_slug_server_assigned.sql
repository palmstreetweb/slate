-- 022_slug_server_assigned.sql (ADR-071, security audit 2026-10). Apply after 021, BEFORE shipping the
-- SPA that reads the slug back from its insert (it works on today's SPA too: a form's slug is simply
-- the one the server picked, and the studio already replaces its draw with what landed). Then refresh
-- the Data API schema cache (`neonctl data-api refresh-schema`); nothing the Data API exposes changes
-- shape, so this is only to keep the cache in step. No Function depends on this file.
--
-- What this fixes (audit 2026-10, server MEDIUM):
--   1. Slug-existence oracle. 015 lets a new row carry any 8-digit slug and lets the unique index
--      answer: 23505 when another account's form (live or trashed) holds it, "slug is retired" when a
--      form was permanently deleted, 201 when it is free. Failed inserts roll back, so the 50-form
--      quota never fills: any signed-in account could test the whole 8-digit space at Data API speed,
--      then read every hit for free. The fix: the server assigns every new form's slug. A client
--      value is ignored unless it is this same account's own retired slug (restoring its own backup,
--      ADR-057). No slug-shaped error can reach a Data API caller any more, and what comes back
--      never confirms or denies anything about other accounts' links.
--   2. (LOW) forms.name, schema and published_schema had no size bound; `op=form` serves and computes
--      over published_schema for free, so one abusive account could make every hit cost megabytes.
--      200 characters and 1 MB of JSON text are far above any real form (today's largest is 1.7 KB).
--   3. (LOW) feedback: unbounded text, and `authenticated` held update/delete grants with no policy
--      behind them. CHECKs, and the grants go.
--   4. (LOW) pgcrypto sits in `public` with PUBLIC execute, so the Data API exposes `gen_salt`,
--      `armor`, `dearmor`, `crypt`, … as anonymous RPCs. Execute is revoked from the Data API roles
--      on exactly those functions. Every caller of ours is SECURITY DEFINER (runs as the owner), so
--      nothing we ship loses access. The loop skips functions the migration's role does not own (it
--      cannot change their grants) and says so in a NOTICE; the harness reports which.
--
-- The rules after this file:
--   - A new form's slug is 8 random digits chosen by the database. The studio shows the slug the
--     insert returns (`.select('slug')`), never its own draw.
--   - The only client slug honoured on INSERT is the account's own retired slug, and only while no
--     form holds it. An upsert of an existing row (a save) keeps that row's slug, as before.
--   - UPDATE never changes a slug (015). Permanent delete still retires it (015).
--
-- Advisory lock keys: 87123001 form quota (010), 87123002 AI quota (014) + slug lock (015, here),
-- 87123003 response cap (019) + sign-up slots (020), 87123004 storage quota (021).
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The insert / update guard. Fires after forms_enforce_owner (triggers run in name order), so
--    new.owner_id is already the signed-in user. Replaces 015's body; same name, same trigger.
-- ---------------------------------------------------------------------------
create or replace function public.forms_slug_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_retired_owner text;
  v_candidate text;
begin
  if tg_op = 'UPDATE' then
    new.slug := old.slug;
    return new;
  end if;

  -- INSERT. Upserts of an existing row land here too, before ON CONFLICT turns them into updates;
  -- the UPDATE branch then pins the stored slug, so nothing is drawn for a save.
  if exists (select 1 from public.forms f where f.id = new.id) then
    return new;
  end if;

  -- The account's own retired slug (restore from backup, ADR-057): the same per-slug lock as the
  -- delete trigger, so a restore that races a permanent delete of that slug sees the retired row.
  if new.slug is not null then
    perform pg_advisory_xact_lock(87123002, hashtext(new.slug));
    select r.owner_id into v_retired_owner
      from public.retired_slugs r
     where r.slug = new.slug;
    if found
       and v_retired_owner is not distinct from new.owner_id
       and not exists (select 1 from public.forms f where f.slug = new.slug) then
      return new;
    end if;
  end if;

  -- Everything else: the server picks. 10000000–99999999 (always 8 digits, never a leading zero),
  -- absent from forms (live and trashed) and from retired_slugs. The lock on the candidate makes
  -- two inserts that draw the same number serialize; the second sees the first's row and draws again.
  loop
    v_candidate := (10000000 + floor(random() * 90000000))::bigint::text;
    perform pg_advisory_xact_lock(87123002, hashtext(v_candidate));
    exit when not exists (select 1 from public.forms f where f.slug = v_candidate)
          and not exists (select 1 from public.retired_slugs r where r.slug = v_candidate);
  end loop;
  new.slug := v_candidate;
  return new;
end;
$$;

-- 015 created the trigger; CREATE OR REPLACE keeps it bound. Grants as in 015: nobody calls it.
revoke all on function public.forms_slug_lock() from public;
do $$ begin
  revoke all on function public.forms_slug_lock() from anonymous, authenticated;
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Size bounds on forms. Validated against every existing row (all are far under; the migration
--    fails loudly if one is not, and nothing is applied).
-- ---------------------------------------------------------------------------
alter table public.forms drop constraint if exists forms_name_length;
alter table public.forms add constraint forms_name_length
  check (char_length(name) <= 200);
alter table public.forms drop constraint if exists forms_schema_size;
alter table public.forms add constraint forms_schema_size
  check (octet_length(schema::text) <= 1048576);
alter table public.forms drop constraint if exists forms_published_schema_size;
alter table public.forms add constraint forms_published_schema_size
  check (published_schema is null or octet_length(published_schema::text) <= 1048576);

-- ---------------------------------------------------------------------------
-- 3. feedback: bounded, insert-only for the Data API role. (011 granted select, insert; 013 took
--    select back; the update/delete grants came from pre-013 default privileges and had no policy
--    behind them. RLS is already forced with 013's owner-role policy.)
-- ---------------------------------------------------------------------------
alter table public.feedback drop constraint if exists feedback_message_length;
alter table public.feedback add constraint feedback_message_length
  check (char_length(message) between 1 and 5000);
alter table public.feedback drop constraint if exists feedback_path_length;
alter table public.feedback add constraint feedback_path_length
  check (path is null or char_length(path) <= 500);
alter table public.feedback drop constraint if exists feedback_email_length;
alter table public.feedback add constraint feedback_email_length
  check (email is null or char_length(email) <= 254);
do $$ begin
  revoke update, delete on table public.feedback from anonymous, authenticated;
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4. pgcrypto: no anonymous or signed-in RPC. Only the functions the extension installed (probin
--    names its library), only in the exposed schema, only where this role may change the grants.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_done integer := 0;
  v_skipped text[] := '{}';
begin
  for r in
    select p.oid::regprocedure as sig, p.proowner
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.probin like '%pgcrypto%'
  loop
    if pg_has_role(current_user, r.proowner, 'MEMBER') then
      execute format('revoke execute on function %s from public', r.sig);
      begin
        execute format('revoke execute on function %s from anonymous, authenticated', r.sig);
      exception when undefined_object then null; end;
      v_done := v_done + 1;
    else
      v_skipped := v_skipped || r.sig::text;
    end if;
  end loop;
  raise notice '022: pgcrypto execute revoked on % function(s); not owned by %, left as is: %',
    v_done, current_user, coalesce(array_to_string(v_skipped, ', '), '(none)');
end $$;

commit;

-- Rollback (ADR-071). Restores 015's forms_slug_lock (the studio keeps working: it still reads the
-- slug back), drops the size and feedback CHECKs, and re-opens pgcrypto. The feedback update/delete
-- grants are not restored: nothing ever used them.
--   begin;
--   create or replace function public.forms_slug_lock()
--   returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
--   declare v_retired_owner text;
--   begin
--     if tg_op = 'UPDATE' then new.slug := old.slug; return new; end if;
--     perform pg_advisory_xact_lock(87123002, hashtext(new.slug));
--     select r.owner_id into v_retired_owner from public.retired_slugs r where r.slug = new.slug;
--     if found then
--       if v_retired_owner is distinct from new.owner_id then
--         raise exception 'slug is retired' using errcode = '23505',
--           detail = 'The slug of a permanently deleted form is never reused.';
--       end if;
--       return new;
--     end if;
--     if new.slug !~ '^[1-9][0-9]{7}$'
--        and not exists (select 1 from public.forms f where f.id = new.id and f.slug = new.slug) then
--       raise exception 'invalid slug' using errcode = '23514',
--         hint = 'New forms get an 8-digit slug (ADR-043).';
--     end if;
--     return new;
--   end;
--   $$;
--   alter table public.forms drop constraint if exists forms_name_length;
--   alter table public.forms drop constraint if exists forms_schema_size;
--   alter table public.forms drop constraint if exists forms_published_schema_size;
--   alter table public.feedback drop constraint if exists feedback_message_length;
--   alter table public.feedback drop constraint if exists feedback_path_length;
--   alter table public.feedback drop constraint if exists feedback_email_length;
--   do $$ declare r record; begin
--     for r in select p.oid::regprocedure as sig from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.probin like '%pgcrypto%'
--         and pg_has_role(current_user, p.proowner, 'MEMBER')
--     loop execute format('grant execute on function %s to public', r.sig); end loop;
--   end $$;
--   commit;
--   then: neonctl data-api refresh-schema
