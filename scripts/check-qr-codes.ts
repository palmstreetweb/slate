/**
 * Branch harness for ADR-075 (Slate · QR codes, migration 025): applies 025 to a THROWAWAY Neon
 * branch of production, then proves as the Data API's roles (set local role + JWT claims, the way
 * PostgREST runs) that owners only ever reach their own codes, that the database owns owner_id /
 * kind / code, that a dynamic destination can only move through set_qr_target with the server key,
 * the 100-code quota (trash included, serialized under parallel inserts), the scan function's
 * answers and counting cap, and retiring on permanent delete. Runs 025's rollback block and
 * re-applies 025 twice. Not part of `npm test`.
 *
 *   npx vite-node scripts/check-qr-codes.ts
 *       creates branch qr-<time> from production, runs, and DELETES it at the end, failed or not.
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-qr-codes.ts
 *       runs against an existing throwaway branch (not deleted).
 *
 * The host must never be production (PROD_ENDPOINT, default ep-misty-snow-ax9wxjvf): asserted
 * before any write. The connection string and the server key are never printed.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

function branchUrl(): string {
  if (process.env.DATABASE_URL) {
    if (process.env.CONFIRM_BRANCH !== '1') {
      throw new Error('Set CONFIRM_BRANCH=1 with DATABASE_URL (a throwaway branch only).');
    }
    return process.env.DATABASE_URL;
  }
  const name = `qr-${Date.now()}`;
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
  return neonctl([
    'connection-string',
    createdBranch,
    '--project-id',
    PROJECT,
    '--role-name',
    'neondb_owner',
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

type PgErr = { code?: string; message?: string };
type Rows = { rows: Record<string, unknown>[]; error: PgErr | null };

async function asRole(
  role: 'authenticated' | 'anonymous',
  sub: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<Rows> {
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
    return { rows: [], error: { code: e.code, message: e.message } };
  } finally {
    c.release();
  }
}

function migrationSql(): string {
  return readFileSync(resolve('neon/migrations/025_qr_codes.sql'), 'utf8');
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

/* ---------- people ---------- */

const OWNER = randomUUID();
const STRANGER = randomUUID();
const FILLER = randomUUID(); // quota runs
const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;

const insertSql = `insert into public.qr_codes (id, owner_id, name, kind, code, target_url, style)
  values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, coalesce($7::jsonb, '{}'::jsonb))
  returning id, owner_id, kind, code, target_url`;

function insertAs(
  sub: string,
  v: {
    id?: string;
    owner?: string;
    name?: string;
    kind: string;
    code?: string;
    target?: string | null;
    style?: unknown;
  },
) {
  return asRole('authenticated', sub, insertSql, [
    v.id ?? null,
    v.owner ?? sub,
    v.name ?? 'Harness',
    v.kind,
    v.code ?? null,
    v.target ?? null,
    v.style === undefined ? null : JSON.stringify(v.style),
  ]);
}

let serverKey = '';
let staticId = '';
let dynamicId = '';
let dynamicCode = '';

/* ---------- scenarios ---------- */

async function ownership() {
  const s = await insertAs(OWNER, {
    kind: 'static',
    owner: STRANGER,
    code: 'abcdefgh',
    target: 'https://example.com/menu',
  });
  const srow = s.rows[0];
  staticId = String(srow?.id ?? '');
  check(
    'static insert: owner stamped from the JWT, client owner and code ignored',
    !s.error && srow?.owner_id === OWNER && srow?.code === null,
    s.error?.message,
  );

  const d = await insertAs(OWNER, {
    kind: 'dynamic',
    code: 'abcdefgh',
    target: 'https://evil.example/phish',
  });
  const drow = d.rows[0];
  dynamicId = String(drow?.id ?? '');
  dynamicCode = String(drow?.code ?? '');
  check(
    'dynamic insert: the database draws the code and drops the client destination',
    !d.error &&
      CODE_RE.test(dynamicCode) &&
      dynamicCode !== 'abcdefgh' &&
      drow?.target_url === null,
    d.error?.message ?? dynamicCode,
  );

  const noTarget = await insertAs(OWNER, { kind: 'static' });
  check('static insert needs a destination', noTarget.error?.code === '23514');

  const badKind = await insertAs(OWNER, { kind: 'wifi', target: 'https://example.com' });
  check('unknown kind is refused', badKind.error?.code === '23514');

  const seen = await asRole(
    'authenticated',
    STRANGER,
    `select id from public.qr_codes where id = any($1::uuid[])`,
    [[staticId, dynamicId]],
  );
  check('a stranger sees none of the owner codes', !seen.error && seen.rows.length === 0);

  const upd = await asRole(
    'authenticated',
    STRANGER,
    `update public.qr_codes set name = 'mine' where id = $1 returning id`,
    [staticId],
  );
  const del = await asRole(
    'authenticated',
    STRANGER,
    `delete from public.qr_codes where id = $1 returning id`,
    [staticId],
  );
  check(
    'a stranger can neither update nor delete them',
    !upd.error && upd.rows.length === 0 && !del.error && del.rows.length === 0,
  );

  const anon = await asRole('anonymous', null, `select id from public.qr_codes limit 1`);
  check('anonymous cannot read qr_codes', anon.error?.code === '42501');
}

async function pinning() {
  const u = await asRole(
    'authenticated',
    OWNER,
    `update public.qr_codes
        set kind = 'static', code = 'zzzzzzzz', owner_id = $2, target_url = 'https://evil.example',
            target_checked_at = now(), name = 'Renamed'
      where id = $1
      returning kind, code, owner_id, target_url, target_checked_at, name`,
    [dynamicId, STRANGER],
  );
  const r = u.rows[0];
  check(
    'owner update: kind, code, owner and the dynamic destination stay; the name moves',
    !u.error &&
      r?.kind === 'dynamic' &&
      r?.code === dynamicCode &&
      r?.owner_id === OWNER &&
      r?.target_url === null &&
      r?.target_checked_at === null &&
      r?.name === 'Renamed',
    u.error?.message,
  );

  const up = await asRole(
    'authenticated',
    OWNER,
    `insert into public.qr_codes (id, owner_id, name, kind, code, target_url)
       values ($1, $2, 'Upserted', 'dynamic', 'zzzzzzzz', 'https://evil.example')
     on conflict (id) do update
       set name = excluded.name, kind = excluded.kind, code = excluded.code, target_url = excluded.target_url
     returning kind, code, target_url, name`,
    [dynamicId, OWNER],
  );
  const ur = up.rows[0];
  check(
    'an upsert of an existing code is a save: code and destination stay',
    !up.error && ur?.code === dynamicCode && ur?.target_url === null && ur?.name === 'Upserted',
    up.error?.message,
  );

  const st = await asRole(
    'authenticated',
    OWNER,
    `update public.qr_codes set target_url = 'https://example.com/new' where id = $1 returning target_url`,
    [staticId],
  );
  check(
    'a static destination is the owner to edit (it never routes through Slate)',
    !st.error && st.rows[0]?.target_url === 'https://example.com/new',
  );

  const bad: Array<[string, string]> = [
    ['javascript:alert(1)', 'javascript:'],
    ['ftp://example.com/file', 'ftp'],
    ['https://user:pw@example.com/', 'credentials'],
    ['https://exa mple.com/', 'whitespace'],
    ['https://', 'no host'],
    [`https://example.com/${'a'.repeat(2030)}`, 'over 2,048'],
  ];
  for (const [url, why] of bad) {
    const r2 = await insertAs(OWNER, { kind: 'static', target: url });
    check(`destination refused: ${why}`, r2.error?.code === '23514', r2.error?.code);
  }

  const big = await insertAs(OWNER, {
    kind: 'static',
    target: 'https://example.com',
    style: { logo: 'x'.repeat(130_000) },
  });
  check('a style over 120 KB is refused', big.error?.code === '23514');
}

async function targetDoor() {
  const [k] = await q<{ key: string }>(`select key from public.qr_server_key`);
  serverKey = k!.key;

  const keyRead = await asRole('authenticated', OWNER, `select key from public.qr_server_key`);
  check('signed-in users cannot read the server key', keyRead.error?.code === '42501');

  const call = (sub: string, id: string, url: string, key: string | null) =>
    asRole('authenticated', sub, `select public.set_qr_target($1::uuid, $2, $3) as t`, [
      id,
      url,
      key,
    ]);

  const none = await call(OWNER, dynamicId, 'https://example.com/a', null);
  const wrong = await call(OWNER, dynamicId, 'https://example.com/a', 'f'.repeat(64));
  check(
    'set_qr_target without the server key, or with a wrong one: 42501',
    none.error?.code === '42501' && wrong.error?.code === '42501',
  );

  const ok = await call(OWNER, dynamicId, 'https://example.com/reviews', serverKey);
  const [row] = await q<{ target_url: string; target_checked_at: Date | null }>(
    `select target_url, target_checked_at from public.qr_codes where id = $1`,
    [dynamicId],
  );
  check(
    'with the key the owner sets the destination, stamped as checked',
    !ok.error &&
      row?.target_url === 'https://example.com/reviews' &&
      row?.target_checked_at !== null,
    ok.error?.message,
  );

  const stranger = await call(STRANGER, dynamicId, 'https://evil.example', serverKey);
  const onStatic = await call(OWNER, staticId, 'https://example.com', serverKey);
  check(
    "the key can't move a stranger's code, or a static one (P0002)",
    stranger.error?.code === 'P0002' && onStatic.error?.code === 'P0002',
  );

  const badUrl = await call(OWNER, dynamicId, 'javascript:alert(1)', serverKey);
  check('set_qr_target still obeys the destination rules', badUrl.error?.code === '23514');

  const anon = await asRole(
    'anonymous',
    null,
    `select public.set_qr_target($1::uuid, 'https://x.example', $2)`,
    [dynamicId, serverKey],
  );
  check('anonymous cannot execute set_qr_target', anon.error?.code === '42501');
}

async function scans() {
  const scan = (code: string | null, ip: string | null, count: boolean) =>
    q<{ status: string; target_url: string | null; counted: boolean }>(
      `select * from public.record_qr_scan($1, $2, $3)`,
      [code, ip, count],
    );
  const total = async () =>
    (
      await q<{ n: number }>(
        `select coalesce(sum(scans), 0)::int as n from public.qr_scan_days where code_id = $1`,
        [dynamicId],
      )
    )[0]!.n;

  for (const role of ['anonymous', 'authenticated'] as const) {
    const r = await asRole(
      role,
      role === 'anonymous' ? null : OWNER,
      `select * from public.record_qr_scan($1, '1.2.3.4', true)`,
      [dynamicCode],
    );
    check(`${role} cannot execute record_qr_scan`, r.error?.code === '42501');
  }

  const [malformed] = await scan('ABC', '1.2.3.4', true);
  const [unknown] = await scan('zzzzzzzz', '1.2.3.4', true);
  check(
    'malformed and unknown codes: not_found, no destination',
    malformed?.status === 'not_found' && unknown?.status === 'not_found' && !unknown?.target_url,
  );

  const [hit] = await scan(dynamicCode, '10.0.0.1', true);
  check(
    'a live code resolves to its destination and is counted',
    hit?.status === 'ok' &&
      hit?.target_url === 'https://example.com/reviews' &&
      hit?.counted === true &&
      (await total()) === 1,
  );

  const [repeat] = await scan(dynamicCode, '10.0.0.1', false);
  check(
    'a scan the edge marks as seen still redirects, uncounted',
    repeat?.status === 'ok' && repeat.counted === false && (await total()) === 1,
  );

  const [noIp] = await scan(dynamicCode, null, true);
  check('no IP: redirect, uncounted', noIp?.status === 'ok' && noIp.counted === false);

  await db.query(
    `create or replace function public.qr_scan_ip_hourly_max() returns integer language sql immutable as $$ select 3 $$`,
  );
  const capped = [];
  for (let i = 0; i < 5; i++) capped.push((await scan(dynamicCode, '10.0.0.2', true))[0]!);
  await db.query(
    `create or replace function public.qr_scan_ip_hourly_max() returns integer language sql immutable as $$ select 500 $$`,
  );
  check(
    'over the per-network cap a scan still redirects, just uncounted',
    capped.every((c) => c.status === 'ok') &&
      capped.filter((c) => c.counted).length === 3 &&
      (await total()) === 4,
    `${capped.filter((c) => c.counted).length} counted`,
  );

  const mine = await asRole(
    'authenticated',
    OWNER,
    `select sum(scans)::int as n from public.qr_scan_days where code_id = $1`,
    [dynamicId],
  );
  const theirs = await asRole(
    'authenticated',
    STRANGER,
    `select count(*)::int as n from public.qr_scan_days where code_id = $1`,
    [dynamicId],
  );
  check(
    'the owner reads their scan counts; a stranger sees no rows',
    mine.rows[0]?.n === 4 && theirs.rows[0]?.n === 0,
  );

  const write = await asRole(
    'authenticated',
    OWNER,
    `update public.qr_scan_days set scans = 99999 where code_id = $1`,
    [dynamicId],
  );
  check('owners cannot write scan counts', write.error?.code === '42501');

  await asRole(
    'authenticated',
    OWNER,
    `update public.qr_codes set deleted_at = now() where id = $1`,
    [dynamicId],
  );
  const [trashed] = await scan(dynamicCode, '10.0.0.3', true);
  check(
    'a trashed code is inactive (no destination, uncounted)',
    trashed?.status === 'inactive' && !trashed.target_url && !trashed.counted,
  );

  const restore = await asRole(
    'authenticated',
    OWNER,
    `update public.qr_codes set deleted_at = null where id = $1 returning id`,
    [dynamicId],
  );
  const [back] = await scan(dynamicCode, '10.0.0.3', true);
  check('restoring it brings the same code back to life', !restore.error && back?.status === 'ok');

  const fresh = await insertAs(OWNER, { kind: 'dynamic' });
  const [unset] = await scan(String(fresh.rows[0]?.code), '10.0.0.4', true);
  check('a dynamic code with no destination yet is inactive', unset?.status === 'inactive');
}

async function retire() {
  const r = await asRole(
    'authenticated',
    OWNER,
    `delete from public.qr_codes where id = $1 returning code`,
    [dynamicId],
  );
  const [ret] = await q<{ n: number }>(
    `select count(*)::int as n from public.retired_qr_codes where code = $1`,
    [dynamicCode],
  );
  check('a permanent delete retires the code', !r.error && ret!.n === 1);

  const [gone] = await q<{ status: string }>(
    `select * from public.record_qr_scan($1, '10.0.0.5', true)`,
    [dynamicCode],
  );
  check('a retired code answers not_found', gone?.status === 'not_found');

  const read = await asRole('authenticated', OWNER, `select code from public.retired_qr_codes`);
  check('signed-in users cannot read retired codes', read.error?.code === '42501');

  const dup = await q<{ ok: boolean }>(
    `select exists (select 1 from public.qr_codes where code = $1) as ok`,
    [dynamicCode],
  );
  check('no live row holds the retired code', dup[0]?.ok === false);
}

async function quota() {
  const [{ n: limit }] = await q<{ n: number }>(`select public.qr_quota_limit() as n`);
  // 95 rows (5 of them in trash), then 10 parallel inserts: exactly 5 may land.
  for (let i = 0; i < 95; i++) {
    const r = await insertAs(FILLER, {
      kind: 'static',
      target: `https://example.com/${i}`,
      name: `Fill ${i}`,
    });
    if (r.error) throw new Error(`quota seed ${i}: ${r.error.message}`);
  }
  await asRole(
    'authenticated',
    FILLER,
    `update public.qr_codes set deleted_at = now() where id in (select id from public.qr_codes where owner_id = $1 limit 5)`,
    [FILLER],
  );
  const parallel = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      insertAs(FILLER, { kind: i % 2 ? 'dynamic' : 'static', target: 'https://example.com/p' }),
    ),
  );
  const landed = parallel.filter((p) => !p.error).length;
  const refused = parallel.filter((p) => p.error?.message === 'QR_QUOTA_EXCEEDED').length;
  check(
    `quota ${limit}, trash included: 10 parallel inserts at 95 → 5 land, 5 refused`,
    limit === 100 && landed === 5 && refused === 5,
    `${landed} landed, ${refused} refused`,
  );

  const status = await asRole('authenticated', FILLER, `select * from public.qr_quota_status()`);
  check(
    'qr_quota_status reports used and limit',
    status.rows[0]?.used === 100 && status.rows[0]?.quota_limit === 100,
  );

  const [one] = await q<{ id: string }>(
    `select id from public.qr_codes where owner_id = $1 limit 1`,
    [FILLER],
  );
  const save = await asRole(
    'authenticated',
    FILLER,
    `insert into public.qr_codes (id, owner_id, name, kind, target_url) values ($1, $2, 'Saved at cap', 'static', 'https://example.com')
     on conflict (id) do update set name = excluded.name returning name`,
    [one!.id, FILLER],
  );
  check(
    'at the cap, saving an existing code still works',
    !save.error && save.rows[0]?.name === 'Saved at cap',
    save.error?.message,
  );

  const del = await asRole('authenticated', FILLER, `delete from public.qr_codes where id = $1`, [
    one!.id,
  ]);
  const after = await insertAs(FILLER, { kind: 'static', target: 'https://example.com/after' });
  check('a permanent delete frees a slot', !del.error && !after.error, after.error?.message);
}

async function rollbackAndReapply() {
  await db.query(rollbackSql());
  const [t] = await q<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name in ('qr_codes', 'qr_scan_days', 'retired_qr_codes', 'qr_server_key')`,
  );
  const [f] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'qr\\_%' or p.proname in ('record_qr_scan', 'set_qr_target'))`,
  );
  check(
    '025 rollback block removes the tables and functions',
    t!.n === 0 && f!.n === 0,
    `${t!.n} tables, ${f!.n} fns`,
  );
  await db.query(migrationSql());
  await db.query(migrationSql());
  const [back] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'record_qr_scan'`,
  );
  const [keys] = await q<{ n: number }>(`select count(*)::int as n from public.qr_server_key`);
  check('025 re-applies (twice: idempotent, one server key)', back!.n === 1 && keys!.n === 1);
}

async function main() {
  try {
    const url = branchUrl();
    assertNotProduction(url);
    db = new pg.Pool({ connectionString: url, max: 12 });
    console.log('[harness] connected to the branch; applying 025');
    await db.query(migrationSql());
    await db.query(migrationSql());
    check('025 applies twice', true);
    await ownership();
    await pinning();
    await targetDoor();
    await scans();
    await retire();
    await quota();
    await rollbackAndReapply();
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
  deleteBranch();
  process.exit(1);
});
