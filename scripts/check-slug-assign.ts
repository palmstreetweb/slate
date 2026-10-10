/**
 * Branch harness for ADR-071 (server-assigned slugs, migration 022): applies 022 to a THROWAWAY Neon
 * branch of production and proves, as the Data API's `authenticated` role (set local role + JWT
 * claims, the way PostgREST runs), that a new form never gets the slug the client asked for unless it
 * is that account's own retired slug; that existing forms keep theirs; that duplicates get fresh
 * ones; that the size and feedback CHECKs hold; which pgcrypto functions the Data API roles can still
 * execute; whether the Functions' pool timeouts reach the server on a direct and on a pooled
 * connection; and that 022's rollback block runs and 022 re-applies. Not part of `npm test`.
 *
 *   npx vite-node scripts/check-slug-assign.ts
 *       creates branch audit2-slug-<time> from production, runs, and DELETES it at the end, failed
 *       or not.
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-slug-assign.ts
 *       runs against an existing throwaway branch (not deleted).
 *
 * The host must never be production (PROD_ENDPOINT, default ep-misty-snow-ax9wxjvf): asserted
 * before any write. The connection string and the branch's credentials are never printed.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const PROJECT = process.env.NEON_PROJECT_ID || 'odd-voice-53972178';
const PROD_ENDPOINT = process.env.PROD_ENDPOINT || 'ep-misty-snow-ax9wxjvf';

/* ---------- the throwaway branch ---------- */

let createdBranch: string | null = null;

function neonctl(args: string[]): string {
  return execFileSync('npx', ['-y', 'neonctl@latest', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertNotProduction(url: string): void {
  const host = new URL(url).hostname;
  if (host.includes(PROD_ENDPOINT) || host.includes('ep-misty-snow')) {
    throw new Error('Refusing: this connection string points at production.');
  }
}

function branchUrl(pooled: boolean): string {
  if (!createdBranch && process.env.DATABASE_URL) {
    if (process.env.CONFIRM_BRANCH !== '1') {
      throw new Error('Set CONFIRM_BRANCH=1 with DATABASE_URL (a throwaway branch only).');
    }
    if (pooled) return process.env.DATABASE_URL_POOLED || '';
    return process.env.DATABASE_URL;
  }
  if (!createdBranch) {
    const name = `audit2-slug-${Date.now()}`;
    // The JSON carries connection URIs with a password: parsed, never printed.
    const out = JSON.parse(
      neonctl([
        'branches',
        'create',
        '--project-id',
        PROJECT,
        '--parent',
        'production',
        '--name',
        name,
        '--output',
        'json',
      ]),
    ) as { branch?: { id?: string }; id?: string };
    createdBranch = out.branch?.id ?? out.id ?? null;
    if (!createdBranch) throw new Error('branches create returned no id');
    console.log(`[harness] created branch ${name} (${createdBranch})`);
  }
  return neonctl([
    'connection-string',
    createdBranch,
    '--project-id',
    PROJECT,
    '--role-name',
    'neondb_owner',
    ...(pooled ? ['--pooled'] : []),
  ]).trim();
}

function deleteBranch(): void {
  if (!createdBranch) return;
  try {
    neonctl(['branches', 'delete', createdBranch, '--project-id', PROJECT]);
    console.log(`[harness] deleted branch ${createdBranch}`);
  } catch (err) {
    console.error(
      `[harness] COULD NOT DELETE BRANCH ${createdBranch}: delete it by hand`,
      err instanceof Error ? err.message.slice(0, 200) : err,
    );
    process.exitCode = 1;
  }
}

/* ---------- results ---------- */

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/* ---------- db ---------- */

let db: pg.Pool;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

type PgErr = { code?: string; message?: string; detail?: string };

/** One statement as a Data API role, the way PostgREST runs it (warm-up, role, claims). */
async function asRole(
  role: 'authenticated' | 'anonymous',
  sub: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Record<string, unknown>[]; error: PgErr | null }> {
  const c = await db.connect();
  try {
    await c.query('select auth.user_id()'); // pg_session_jwt warm-up as neondb_owner
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return { rows: r.rows as Record<string, unknown>[], error: null };
  } catch (err) {
    await c.query('rollback').catch(() => {});
    const e = err as PgErr;
    return { rows: [], error: { code: e.code, message: e.message, detail: e.detail } };
  } finally {
    c.release();
  }
}

const OWNER = 'u_s22_owner';
const STRANGER = 'u_s22_stranger';
const RACER = 'u_s22_racer';
const schema = { brand: { name: 'Harness brand' }, questions: [{ id: 'q', type: 'short_text' }] };
let seq = 0;
const newId = () => `f_s22${String(++seq).padStart(6, '0')}`;

/** What the studio's insertForm sends: a row with the client's draw, `returning slug`. */
async function insertAs(
  sub: string,
  slug: string | null,
  extra: { id?: string; name?: string; schema?: unknown } = {},
) {
  return asRole(
    'authenticated',
    sub,
    `insert into public.forms (id, name, slug, schema, status)
     values ($1, $2, $3, $4::jsonb, 'draft') returning id, slug`,
    [extra.id ?? newId(), extra.name ?? 'Harness', slug, JSON.stringify(extra.schema ?? schema)],
  );
}

function migrationSql(): string {
  return readFileSync(resolve('neon/migrations/022_slug_server_assigned.sql'), 'utf8');
}

function rollbackSql(): string {
  const text = migrationSql();
  return text
    .slice(text.indexOf('-- Rollback'))
    .split('\n')
    .filter((l) => l.startsWith('--   '))
    .map((l) => l.slice(5))
    .filter((l) => !l.startsWith('then:'))
    .join('\n');
}

const SLUG8 = /^[1-9][0-9]{7}$/;

/* ---------- scenarios ---------- */

async function slugs() {
  // The state before: every live form's slug, to prove nothing moves.
  const before = await q<{ id: string; slug: string }>(
    `select id, slug from public.forms order by id`,
  );

  // Seed: an owner's form (live), a trashed one, and a retired slug, all as the Data API role.
  const own = await insertAs(OWNER, '12345678');
  const ownSlug = String(own.rows[0]?.slug);
  check(
    'a new form never gets the slug the client asked for; it gets 8 server digits',
    !own.error && SLUG8.test(ownSlug) && ownSlug !== '12345678',
    `asked 12345678, got ${ownSlug}${own.error ? ` err=${own.error.code}` : ''}`,
  );

  const trashed = await insertAs(OWNER, null);
  const trashedSlug = String(trashed.rows[0]?.slug);
  await q(`update public.forms set deleted_at = now() where id = $1`, [trashed.rows[0]?.id]);
  check(
    'a null slug from the client is fine: the server fills it',
    !trashed.error && SLUG8.test(trashedSlug),
    `got ${trashedSlug}${trashed.error ? ` err=${trashed.error.code}` : ''}`,
  );

  // (a) Another account asks for this owner's live slug, trashed slug, and a retired slug: a fresh
  //     slug every time, never 23505, and the three answers are indistinguishable.
  const retiredId = newId();
  const retired = await insertAs(OWNER, null, { id: retiredId });
  const retiredSlug = String(retired.rows[0]?.slug);
  await asRole('authenticated', OWNER, `delete from public.forms where id = $1`, [retiredId]);
  const [retiredRow] = await q(`select owner_id from public.retired_slugs where slug = $1`, [
    retiredSlug,
  ]);
  check('permanent delete still retires the slug (015)', retiredRow?.owner_id === OWNER);

  const probes = await Promise.all([
    insertAs(STRANGER, ownSlug),
    insertAs(STRANGER, trashedSlug),
    insertAs(STRANGER, retiredSlug),
    insertAs(STRANGER, '87654321'),
    insertAs(STRANGER, 'not-a-slug-at-all'),
    insertAs(STRANGER, 'new'),
  ]);
  const got = probes.map((p) => (p.error ? `ERR:${p.error.code}` : String(p.rows[0]?.slug)));
  check(
    '(a) a stranger asking for a live, a trashed, a retired, a free, a malformed and the `new` slug gets a fresh 8-digit slug each time, no error',
    probes.every((p) => !p.error) &&
      got.every((s) => SLUG8.test(s)) &&
      !got.includes(ownSlug) &&
      !got.includes(trashedSlug) &&
      !got.includes(retiredSlug) &&
      !got.includes('87654321') &&
      new Set(got).size === got.length,
    got.join(' '),
  );

  // (b) The owner brings its own retired slug back (restore from backup): kept.
  const reclaim = await insertAs(OWNER, retiredSlug);
  check(
    '(b) the owner inserting its own retired slug gets it back',
    !reclaim.error && reclaim.rows[0]?.slug === retiredSlug,
    `${String(reclaim.rows[0]?.slug)}${reclaim.error ? ` err=${reclaim.error.code}` : ''}`,
  );
  const again = await insertAs(OWNER, retiredSlug);
  check(
    '(b) a second restore of the same slug, while the first row holds it, gets a fresh slug (no 23505)',
    !again.error && SLUG8.test(String(again.rows[0]?.slug)) && again.rows[0]?.slug !== retiredSlug,
    `${String(again.rows[0]?.slug)}${again.error ? ` err=${again.error.code}` : ''}`,
  );

  // A save (upsert of an existing id) keeps the row's slug, even when it re-sends an older draw.
  const saveId = String(own.rows[0]?.id);
  const save = await asRole(
    'authenticated',
    OWNER,
    `insert into public.forms (id, name, slug, schema, status)
     values ($1, 'Harness saved', '99999999', $2::jsonb, 'draft')
     on conflict (id) do update set name = excluded.name, schema = excluded.schema
     returning slug, name`,
    [saveId, JSON.stringify(schema)],
  );
  check(
    'a save (upsert of an existing row) keeps the stored slug and applies the edit',
    !save.error && save.rows[0]?.slug === ownSlug && save.rows[0]?.name === 'Harness saved',
    `${String(save.rows[0]?.slug)}${save.error ? ` err=${save.error.code} ${save.error.message}` : ''}`,
  );
  const patch = await asRole(
    'authenticated',
    OWNER,
    `update public.forms set slug = '11111111' where id = $1 returning slug`,
    [saveId],
  );
  check(
    'UPDATE never changes a slug (015)',
    !patch.error && patch.rows[0]?.slug === ownSlug,
    String(patch.rows[0]?.slug),
  );

  // A word slug (pre-ADR-043 shape) on a NEW row is assigned 8 digits like any other.
  const word = await insertAs(OWNER, 'spring-fair', { name: 'Word slug' });
  check(
    'a word slug on a new row is assigned 8 digits too (the shape CHECK never answers)',
    !word.error && SLUG8.test(String(word.rows[0]?.slug)),
    `${String(word.rows[0]?.slug)}${word.error ? ` err=${word.error.code}` : ''}`,
  );

  // (c) Existing forms keep their slugs.
  const after = await q<{ id: string; slug: string }>(
    `select id, slug from public.forms where id = any($1::text[]) order by id`,
    [before.map((r) => r.id)],
  );
  check(
    '(c) every form that existed before keeps its slug',
    after.length === before.length && after.every((r, i) => r.slug === before[i]!.slug),
    `${before.length} forms`,
  );

  // (d) Duplicates: the studio inserts a copy with a fresh id and a placeholder slug.
  const dupA = await insertAs(OWNER, ownSlug, { name: 'Copy of Harness' });
  const dupB = await insertAs(OWNER, ownSlug, { name: 'Copy of Harness' });
  check(
    '(d) duplicating a form (same slug re-sent, new id) gets a new slug each time',
    !dupA.error &&
      !dupB.error &&
      SLUG8.test(String(dupA.rows[0]?.slug)) &&
      SLUG8.test(String(dupB.rows[0]?.slug)) &&
      dupA.rows[0]?.slug !== ownSlug &&
      dupB.rows[0]?.slug !== ownSlug &&
      dupA.rows[0]?.slug !== dupB.rows[0]?.slug,
    `${String(dupA.rows[0]?.slug)} ${String(dupB.rows[0]?.slug)}`,
  );

  // Race: 48 inserts at once on 16 connections (under the 50-form quota), one account, all asking
  // for the same slug.
  const wide = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 16 });
  const raced: string[] = [];
  let errors = 0;
  await Promise.all(
    Array.from({ length: 48 }, async () => {
      const c = await wide.connect();
      try {
        await c.query('select auth.user_id()');
        await c.query('begin');
        await c.query('set local role authenticated');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: RACER, role: 'authenticated' }),
        ]);
        const r = await c.query<{ slug: string }>(
          `insert into public.forms (id, name, slug, schema, status)
           values ($1, 'Race', '55555555', $2::jsonb, 'draft') returning slug`,
          [newId(), JSON.stringify(schema)],
        );
        await c.query('commit');
        raced.push(r.rows[0]!.slug);
      } catch {
        await c.query('rollback').catch(() => {});
        errors += 1;
      } finally {
        c.release();
      }
    }),
  );
  await wide.end();
  check(
    'race: 48 concurrent inserts asking for one slug → 48 distinct fresh slugs, no errors',
    errors === 0 &&
      raced.length === 48 &&
      new Set(raced).size === 48 &&
      !raced.includes('55555555'),
    `distinct=${new Set(raced).size} errors=${errors}`,
  );
}

async function sizes() {
  const big = { ...schema, pad: 'x'.repeat(1_100_000) };
  const tooBig = await insertAs(OWNER, null, { schema: big });
  const okBig = await insertAs(OWNER, null, { schema: { ...schema, pad: 'x'.repeat(900_000) } });
  const longName = await insertAs(OWNER, null, { name: 'n'.repeat(201) });
  const okName = await insertAs(OWNER, null, { name: 'n'.repeat(200) });
  check(
    'forms: schema over 1 MB and a 201-character name are 23514; 900 KB and 200 characters pass',
    tooBig.error?.code === '23514' &&
      longName.error?.code === '23514' &&
      !okBig.error &&
      !okName.error,
    `big=${tooBig.error?.code ?? 'ok'} name=${longName.error?.code ?? 'ok'} okBig=${okBig.error?.code ?? 'ok'} okName=${okName.error?.code ?? 'ok'}`,
  );
  const pubBig = await asRole(
    'authenticated',
    OWNER,
    `update public.forms set published_schema = $2::jsonb, status = 'published' where id = $1`,
    [okBig.rows[0]?.id, JSON.stringify(big)],
  );
  check(
    'forms: published_schema over 1 MB is 23514',
    pubBig.error?.code === '23514',
    pubBig.error?.code,
  );
}

async function feedback() {
  const ok = await asRole(
    'authenticated',
    OWNER,
    `insert into public.feedback (owner_id, email, message, path) values ($1, 'a@b.c', 'hi', '/x')`,
    [OWNER],
  );
  const long = await asRole(
    'authenticated',
    OWNER,
    `insert into public.feedback (owner_id, email, message, path) values ($1, 'a@b.c', $2, '/x')`,
    [OWNER, 'm'.repeat(5001)],
  );
  const empty = await asRole(
    'authenticated',
    OWNER,
    `insert into public.feedback (owner_id, email, message) values ($1, 'a@b.c', '')`,
    [OWNER],
  );
  const upd = await asRole('authenticated', OWNER, `update public.feedback set message = 'x'`);
  const del = await asRole('authenticated', OWNER, `delete from public.feedback`);
  check(
    'feedback: a note inserts; 5,001 characters and an empty note are 23514; update and delete are 42501',
    !ok.error &&
      long.error?.code === '23514' &&
      empty.error?.code === '23514' &&
      upd.error?.code === '42501' &&
      del.error?.code === '42501',
    `ok=${ok.error?.code ?? 'ok'} long=${long.error?.code} empty=${empty.error?.code} upd=${upd.error?.code} del=${del.error?.code}`,
  );
}

async function pgcrypto() {
  const rows = await q<{ sig: string; owner: string; anon: boolean; auth: boolean; mine: boolean }>(
    `select p.oid::regprocedure::text as sig, p.proowner::regrole::text as owner,
            has_function_privilege('anonymous', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            pg_has_role(current_user, p.proowner, 'MEMBER') as mine
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.probin like '%pgcrypto%'
      order by 1`,
  );
  const open = rows.filter((r) => r.anon || r.auth);
  const owners = [...new Set(rows.map((r) => r.owner))];
  console.log(
    `[harness] pgcrypto: ${rows.length} functions, owner(s) ${owners.join(', ')}, ` +
      `${rows.filter((r) => r.mine).length} changeable by this role, ${open.length} still executable by a Data API role`,
  );
  if (open.length) console.log(`[harness]   still open: ${open.map((r) => r.sig).join(', ')}`);
  check(
    'pgcrypto: no function the migration could change is executable by anonymous or authenticated',
    rows.filter((r) => r.mine).every((r) => !r.anon && !r.auth),
    `${open.length} open of ${rows.length}`,
  );
  const [v] = await q<{ v: string }>('select version() as v');
  console.log(`[harness] ${v!.v.split(' on ')[0]}`);
  // Our own callers still work (SECURITY DEFINER runs as the owner).
  const pw = await asRole(
    'authenticated',
    OWNER,
    `select public.set_form_fill_password($1, 'secret-pw-1') as locked`,
    [
      (
        await q<{ id: string }>(`select id from public.forms where owner_id = $1 limit 1`, [OWNER])
      )[0]!.id,
    ],
  );
  check(
    'set_form_fill_password (crypt + gen_salt inside SECURITY DEFINER) still works for the owner',
    !pw.error && pw.rows[0]?.locked === true,
    pw.error ? `${pw.error.code} ${pw.error.message}` : 'locked',
  );
  const anonSalt = await asRole('anonymous', null, `select gen_salt('bf', 4) as s`);
  check(
    'anonymous gen_salt is refused (42501) when the role could change it, else reported above',
    rows.some((r) => r.sig.startsWith('gen_salt') && r.mine)
      ? anonSalt.error?.code === '42501'
      : true,
    anonSalt.error?.code ?? 'allowed',
  );
}

async function timeouts() {
  const direct = process.env.DATABASE_URL!;
  const pooled = branchUrl(true);
  const settings = async (p: pg.Pool) => {
    const { rows } = await p.query<{ st: string; lt: string }>(
      `select current_setting('statement_timeout') as st, current_setting('lock_timeout') as lt`,
    );
    return `${rows[0]?.st}/${rows[0]?.lt}`;
  };
  for (const [label, url] of [
    ['direct', direct],
    ['pooled', pooled],
  ] as const) {
    if (!url) {
      console.log(`[harness] ${label}: no connection string, skipped`);
      continue;
    }
    assertNotProduction(url);
    // Three ways to reach the server with a ceiling. Seen on a branch (2026-10-09): pg's
    // statement_timeout / lock_timeout startup parameters are dropped by Neon's proxy (0/0 on both
    // strings); `options` works on the direct string and is refused (08P01) on the pooled one; a SET
    // on connect reaches the server on both. Through a transaction pooler a session SET is best
    // effort (the next statement may run on another backend), so the Functions also keep pg's
    // client-side query_timeout.
    const viaConfig = new pg.Pool({
      connectionString: url,
      max: 1,
      statement_timeout: 8000,
      lock_timeout: 4000,
    });
    const viaOptions = new pg.Pool({
      connectionString: url,
      max: 1,
      options: '-c statement_timeout=8000 -c lock_timeout=4000',
    });
    const viaConnect = new pg.Pool({ connectionString: url, max: 1 });
    viaConnect.on('connect', (c) => {
      void c.query(`set statement_timeout = 8000; set lock_timeout = 4000`);
    });
    try {
      const got = {
        config: await settings(viaConfig).catch((e: PgErr) => `ERR ${e.code ?? e.message}`),
        options: await settings(viaOptions).catch((e: PgErr) => `ERR ${e.code ?? e.message}`),
        connect: await settings(viaConnect).catch((e: PgErr) => `ERR ${e.code ?? e.message}`),
      };
      console.log(
        `[harness] ${label}: Pool{statement_timeout,lock_timeout} → ${got.config}; ` +
          `Pool{options:'-c …'} → ${got.options}; on('connect') SET → ${got.connect}`,
      );
      check(
        `${label}: the way the Functions set their ceiling (on connect) reaches the server (8s / 4s)`,
        got.connect === '8s/4s',
        got.connect,
      );
      let code = 'none';
      try {
        await viaConnect.query(`select pg_sleep(9)`);
      } catch (err) {
        code = (err as PgErr).code ?? (err as Error).message;
      }
      check(
        `${label}: a 9 s statement fails with 57014 under that ceiling`,
        code === '57014',
        code,
      );
    } finally {
      await Promise.all([viaConfig.end(), viaOptions.end(), viaConnect.end()]);
    }
  }
}

async function rollbackAndReapply() {
  await db.query(rollbackSql());
  const [cons] = await q<{ n: number }>(
    `select count(*)::int as n from pg_constraint where conname in
       ('forms_name_length', 'forms_schema_size', 'forms_published_schema_size',
        'feedback_message_length', 'feedback_path_length', 'feedback_email_length')`,
  );
  const stranger = await insertAs(STRANGER, '12345678');
  await asRole('authenticated', STRANGER, `delete from public.forms where id = $1`, [
    stranger.rows[0]?.id,
  ]);
  const clash = await insertAs(OWNER, '12345678');
  check(
    "(e) 022's rollback block runs: CHECKs gone, 015's trigger back (a stranger's retired slug is 23505 again)",
    cons!.n === 0 &&
      !stranger.error &&
      stranger.rows[0]?.slug === '12345678' &&
      clash.error?.code === '23505',
    `constraints=${cons!.n} stranger=${stranger.error?.code ?? stranger.rows[0]?.slug} clash=${clash.error?.code ?? 'ok'}`,
  );
  await db.query(migrationSql());
  await db.query(migrationSql());
  const back = await insertAs(OWNER, '12345678');
  check(
    '022 re-applied (twice: idempotent): the server assigns again',
    !back.error && SLUG8.test(String(back.rows[0]?.slug)) && back.rows[0]?.slug !== '12345678',
    String(back.rows[0]?.slug ?? back.error?.code),
  );
}

async function cleanup() {
  await q(`delete from public.forms where owner_id in ($1, $2, $3)`, [OWNER, STRANGER, RACER]);
  await q(`delete from public.retired_slugs where owner_id in ($1, $2, $3)`, [
    OWNER,
    STRANGER,
    RACER,
  ]);
  await q(`delete from public.feedback where owner_id = $1`, [OWNER]);
}

async function main() {
  try {
    const url = branchUrl(false);
    assertNotProduction(url);
    // Later probes (the race pool, the timeout probe) read it from here; branchUrl() itself only
    // trusts a pre-set DATABASE_URL with CONFIRM_BRANCH=1.
    process.env.DATABASE_URL = url;
    db = new pg.Pool({ connectionString: url, max: 8 });
    db.on('connect', (c) => c.on('notice', (m) => console.log(`[notice] ${m.message}`)));
    const [host] = await q<{ h: string }>(`select inet_server_addr()::text as h`);
    console.log(`[harness] connected to the branch (server ${host?.h ?? '?'}); applying 022`);
    await db.query(migrationSql());
    await slugs();
    await sizes();
    await feedback();
    await pgcrypto();
    await timeouts();
    await rollbackAndReapply();
    await cleanup();
  } finally {
    await db?.end().catch(() => {});
    deleteBranch();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  process.exit(failed.length || process.exitCode ? 1 : 0);
}

main().catch((err) => {
  console.error('[harness] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
