/**
 * Branch harness for ADR-058: runs the REAL submitresponse and storagesign Hono
 * apps in-process against a THROWAWAY Neon branch with migration 016 applied,
 * and prints a pass/fail line per scenario, p50/p95 latency per path, and the
 * submit_rate_buckets write counters. Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch pooled neondb_owner> npx vite-node scripts/check-rate-limits.ts
 *
 * Env:
 *   CONFIRM_BRANCH=1   required; refuses to run otherwise.
 *   DATABASE_URL       the branch's POOLED neondb_owner string. Never production:
 *                      the host must not contain PROD_ENDPOINT (default ep-misty-snow).
 *   APP_DIR            Functions folder (default neon/functions). The BEFORE run points
 *                      it at a 20b6fba worktree (with node_modules symlinked in).
 *   MODE               'full' (default): scenarios + latency + counters.
 *                      'latency': latency only (use for the pre-016 BEFORE run).
 *
 * Data is seeded on the branch only (owner ids u_s8h_*, form ids f_s8h*), and each
 * scenario uses its own X-Forwarded-For range and deletes its own rate rows.
 */

import { generateKeyPairSync, sign as edSign, randomUUID, type KeyObject } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

type App = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

const PROD_ENDPOINT = process.env.PROD_ENDPOINT || 'ep-misty-snow';
const MODE = process.env.MODE === 'latency' ? 'latency' : 'full';
const APP_DIR = resolve(process.env.APP_DIR || 'neon/functions');
const AUTH_BASE = 'https://auth.test/neondb/auth';

function refuseUnlessBranch(): string {
  const url = process.env.DATABASE_URL;
  if (process.env.CONFIRM_BRANCH !== '1')
    throw new Error('Set CONFIRM_BRANCH=1 (throwaway branch only).');
  if (!url) throw new Error('DATABASE_URL is required.');
  const host = new URL(url).hostname;
  if (host.includes(PROD_ENDPOINT)) throw new Error('Refusing: DATABASE_URL points at production.');
  return url;
}

const DB_URL = refuseUnlessBranch();

/* ---------- env + JWKS stub, before the apps load ---------- */

process.env.NEON_AUTH_URL = AUTH_BASE;
process.env.AWS_ENDPOINT_URL_S3 = 'http://127.0.0.1:9';
process.env.AWS_ACCESS_KEY_ID = 'harness';
process.env.AWS_SECRET_ACCESS_KEY = 'harness';
process.env.AWS_REGION = 'us-east-2';

const keys = generateKeyPairSync('ed25519');
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'harness-kid', alg: 'EdDSA' };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://auth.test/')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

function userJwt(sub: string, key: KeyObject = keys.privateKey): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'EdDSA', kid: 'harness-kid' });
  const body = b64({
    sub,
    role: 'authenticated',
    iss: 'https://auth.test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${head}.${body}.${edSign(null, Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

/* ---------- db helpers ---------- */

const db = new pg.Pool({ connectionString: DB_URL, max: 4 });
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

const OWNER_X = 'u_s8h_owner_x';
const OWNER_Y = 'u_s8h_owner_y';
const FORM_X = 'f_s8hopenx0001';
const FORM_Y = 'f_s8hopeny0001';
const FORM_L = 'f_s8hlockx0001';
const PASSWORD = 'crowd-pass-1';
let SLUG_L = '';

const schema = {
  questions: [
    { id: 'q_name', type: 'short_text', title: 'Name' },
    { id: 'q_note', type: 'long_text', title: 'Note' },
    { id: 'q_file', type: 'file_upload', title: 'Photos' },
  ],
};

async function asOwner(sub: string, sql: string, params: unknown[]) {
  const c = await db.connect();
  try {
    await c.query('select auth.user_id()'); // pg_session_jwt warm-up as neondb_owner
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub, role: 'authenticated' }),
    ]);
    await c.query(sql, params);
    await c.query('commit');
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const slug8 = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));

async function seed() {
  await q(`delete from public.forms where id like 'f_s8h%'`);
  for (const [id, owner] of [
    [FORM_X, OWNER_X],
    [FORM_Y, OWNER_Y],
    [FORM_L, OWNER_X],
  ] as const) {
    const slug = slug8();
    if (id === FORM_L) SLUG_L = slug;
    await asOwner(
      owner,
      `insert into public.forms (id, name, slug, schema, published_schema, status)
       values ($1, $2, $3, $4::jsonb, $4::jsonb, 'published')`,
      [id, `Harness ${id}`, slug, JSON.stringify(schema)],
    );
  }
  await q(
    `update public.forms set fill_password_hash = crypt($2, gen_salt('bf', 8)) where id = $1`,
    [FORM_L, PASSWORD],
  );
  const rows = await q<{ id: string; owner_id: string; locked: boolean }>(
    `select id, owner_id, fill_password_hash is not null as locked from public.forms where id like 'f_s8h%' order by id`,
  );
  if (rows.length !== 3 || rows.find((r) => r.id === FORM_X)?.owner_id !== OWNER_X) {
    throw new Error(`seed failed: ${JSON.stringify(rows)}`);
  }
}

async function clearRates(pattern: string) {
  await q(`delete from public.submit_rate_buckets where bucket_key like $1`, [pattern]);
}

/* ---------- request helpers ---------- */

let submitApp: App;
let signApp: App;

function post(app: App, body: unknown, ip: string | null, headers: Record<string, string> = {}) {
  return app.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const meta = () => ({
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 1000,
  questionsVisited: ['q_name'],
  hiddenFields: {},
});
const submit = (ip: string, formId = FORM_X, note = 'hello', unlockToken?: string) =>
  post(
    submitApp,
    { formId, answers: { q_name: 'Ada', q_note: note }, meta: meta(), unlockToken },
    ip,
  );
const unlock = (ip: string, proof: Record<string, string>) =>
  post(submitApp, { op: 'unlock', slug: SLUG_L, ...proof }, ip);
const signUpload = (
  ip: string,
  contentLength: unknown,
  formId = FORM_X,
  bearer?: string,
  scope = 'public',
) =>
  post(
    signApp,
    {
      op: 'upload',
      path: `${scope}/${formId}/${randomUUID()}/photo.jpg`,
      contentType: 'image/jpeg',
      contentLength,
    },
    ip,
    bearer ? { Authorization: `Bearer ${bearer}` } : {},
  );

/* ---------- reporting ---------- */

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function statuses(
  n: number,
  fn: (i: number) => Response | Promise<Response>,
  concurrency = 8,
) {
  const out: number[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, n) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= n) return;
        const res = await fn(i);
        out[i] = res.status;
        await res.arrayBuffer().catch(() => {});
      }
    }),
  );
  return out;
}

const count = (xs: number[], s: number) => xs.filter((x) => x === s).length;

async function tableStats() {
  const [r] = await q<{
    n_tup_upd: string;
    n_tup_hot_upd: string;
    n_dead_tup: string;
    n_tup_ins: string;
  }>(
    `select n_tup_ins, n_tup_upd, n_tup_hot_upd, n_dead_tup from pg_stat_user_tables where relname = 'submit_rate_buckets'`,
  );
  return r!;
}

/* ---------- scenarios (AFTER only) ---------- */

async function scenarios() {
  // Crowd: 300 submits from one venue IP to one form.
  {
    const ip = '10.1.0.1';
    const s = await statuses(300, () => submit(ip), 6);
    check(
      'crowd: 300 submits from one XFF all 200',
      count(s, 200) === 300,
      `200s=${count(s, 200)}`,
    );
    await clearRates('%10.1.0.1%');
  }

  // M-RL-1 reversed: junk ids write nothing and cost the network nothing.
  {
    const ip = '10.2.0.1';
    const junk = await statuses(30, (i) => submit(ip, `f_junk${String(i).padStart(8, '0')}`), 6);
    const rows = await q<{ n: number }>(
      `select count(*)::int as n from public.submit_rate_buckets where bucket_key like '%10.2.0.1%'`,
    );
    const real = await submit(ip);
    check(
      'M-RL-1: 30 junk ids then a real submit from the same IP is 200, no rate rows for the junk',
      count(junk, 404) === 30 && rows[0]!.n === 0 && real.status === 200,
      `junk404=${count(junk, 404)} rows=${rows[0]!.n} real=${real.status}`,
    );
    await clearRates('%10.2.0.1%');
  }

  // Owner isolation + denied flood.
  {
    const ip = '10.3.0.1';
    const big = 'x'.repeat(60_000); // ~15 units each
    let sent = 0;
    let last = 200;
    while (last === 200 && sent < 400) {
      const res = await submit(ip, FORM_X, big);
      last = res.status;
      await res.arrayBuffer();
      sent += 1;
    }
    // Top up with 1-unit submits until the bucket is exactly full.
    last = 200;
    while (last === 200 && sent < 800) {
      const res = await submit(ip, FORM_X);
      last = res.status;
      await res.arrayBuffer();
      sent += 1;
    }
    const [row] = await q<{ hit_count: number }>(
      `select hit_count from public.submit_rate_buckets where bucket_key = $1`,
      [`sub:ipowner:${ip}:${OWNER_X}`],
    );
    const small = await submit(ip, FORM_X);
    const y = await submit(ip, FORM_Y);
    check(
      'owner isolation: X fills to ~2,000 units then 429; owner Y from the same IP is 200',
      last === 429 && small.status === 429 && y.status === 200 && row!.hit_count === 2000,
      `requests=${sent} units=${row!.hit_count} next=${small.status} ownerY=${y.status}`,
    );

    const keysSql = `select bucket_key, xmin::text as xmin, hit_count from public.submit_rate_buckets
                     where bucket_key in ($1, $2) order by bucket_key`;
    const k = [`sub:ipowner:${ip}:${OWNER_X}`, `sub:ip:${ip}`];
    await q('select pg_stat_clear_snapshot()');
    await new Promise((r) => setTimeout(r, 1500));
    const before = await q(keysSql, k);
    const stBefore = await tableStats();
    const flood = await statuses(200, () => submit(ip, FORM_X), 8);
    await new Promise((r) => setTimeout(r, 1500));
    await q('select pg_stat_clear_snapshot()');
    const after = await q(keysSql, k);
    const stAfter = await tableStats();
    check(
      'denied flood: 200 more to X are 429, bucket xmin and n_tup_upd unchanged',
      count(flood, 429) === 200 &&
        JSON.stringify(before) === JSON.stringify(after) &&
        stBefore.n_tup_upd === stAfter.n_tup_upd,
      `429s=${count(flood, 429)} xminSame=${JSON.stringify(before) === JSON.stringify(after)} n_tup_upd ${stBefore.n_tup_upd}→${stAfter.n_tup_upd}`,
    );
    await clearRates('%10.3.0.1%');
  }

  // Locked form.
  {
    const crowd = '10.4.0.1';
    const outcomes = await statuses(
      360,
      (i) => unlock(crowd, { password: i % 6 === 5 ? `wrong-${i}` : PASSWORD }),
      6,
    );
    const right = outcomes.filter((_, i) => i % 6 !== 5);
    const wrong = outcomes.filter((_, i) => i % 6 === 5);
    check(
      'locked: 300 right + 60 wrong from the crowd IP; every right one is 200',
      count(right, 200) === 300 && count(wrong, 401) === 60,
      `right200=${count(right, 200)} wrong401=${count(wrong, 401)}`,
    );

    const others = ['10.4.1.1', '10.4.1.2', '10.4.1.3'];
    const floods = await Promise.all(
      others.map((ip) => statuses(100, (i) => unlock(ip, { password: `nope-${i}` }), 2)),
    );
    const all = floods.flat();
    check(
      'locked: 3 other IPs send 100 wrong each, filling the per-form ceiling',
      count(all, 401) + count(all, 429) === 300 && count(all, 429) > 0,
      `401=${count(all, 401)} 429=${count(all, 429)}`,
    );

    const fresh = '10.4.2.1';
    const tries = [];
    for (let i = 0; i < 4; i++)
      tries.push((await unlock(fresh, { password: `guess-${i}` })).status);
    check(
      'locked: a fresh 5th IP still gets 3 checked tries, then the ceiling applies',
      tries.join(',') === '401,401,401,429',
      tries.join(','),
    );

    const proven = await unlock(crowd, { password: PASSWORD });
    const body = (await proven.json()) as { unlockToken?: string };
    check(
      'locked: the proven crowd IP still unlocks',
      proven.status === 200,
      `status=${proven.status}`,
    );

    const rowsBefore = await q<{ n: number; s: number }>(
      `select count(*)::int as n, coalesce(sum(hit_count), 0)::int as s from public.submit_rate_buckets where bucket_key like 'unlock:%'`,
    );
    const reloads = await statuses(
      20,
      () => unlock('10.4.3.1', { token: body.unlockToken ?? '' }),
      4,
    );
    const rowsAfter = await q<{ n: number; s: number }>(
      `select count(*)::int as n, coalesce(sum(hit_count), 0)::int as s from public.submit_rate_buckets where bucket_key like 'unlock:%'`,
    );
    check(
      'locked: token reloads are 200 and cost no rate row',
      count(reloads, 200) === 20 && JSON.stringify(rowsBefore) === JSON.stringify(rowsAfter),
      `200s=${count(reloads, 200)} rows ${JSON.stringify(rowsBefore)}→${JSON.stringify(rowsAfter)}`,
    );
    const lockedSubmit = await submit('10.4.3.1', FORM_L, 'hi', body.unlockToken);
    check(
      'locked: submit with the token is 200',
      lockedSubmit.status === 200,
      `status=${lockedSubmit.status}`,
    );
    await clearRates('unlock:%');
    await clearRates('%10.4.%');
  }

  // Uploads.
  {
    const ip = '10.5.0.1';
    const photos = await statuses(900, () => signUpload(ip, 450_000), 8);
    const scans = await statuses(50, () => signUpload(ip, 12_000_000), 8);
    check(
      'uploads: 900 photo signs + 50 × 12 MB signs from one IP are 200',
      count(photos, 200) === 900 && count(scans, 200) === 50,
      `photos=${count(photos, 200)} scans=${count(scans, 200)}`,
    );
    const huge = await signUpload(ip, 1e20);
    check('uploads: contentLength 1e20 is 400', huge.status === 400, `status=${huge.status}`);
    const pad = new TextEncoder().encode(
      JSON.stringify({ op: 'upload', pad: 'a'.repeat(9 * 1024) }),
    );
    const chunked = await signApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < pad.length; i += 1024) c.enqueue(pad.slice(i, i + 1024));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    check(
      'uploads: a 9 KiB chunked body is 413',
      chunked.status === 413,
      `status=${chunked.status}`,
    );

    const readIp = '10.5.1.1';
    const jwt = userJwt(OWNER_X);
    const path = `public/${FORM_X}/${randomUUID()}/photo.jpg`;
    const reads = await statuses(
      3000,
      () => post(signApp, { op: 'download', path }, readIp, { Authorization: `Bearer ${jwt}` }),
      10,
    );
    const over = await post(signApp, { op: 'download', path }, readIp, {
      Authorization: `Bearer ${jwt}`,
    });
    check(
      'owner reads (local JWKS): 3,000 then 429',
      count(reads, 200) === 3000 && over.status === 429,
      `200s=${count(reads, 200)} next=${over.status}`,
    );
    const anonIp = '10.5.2.1';
    const anon = await post(signApp, { op: 'meta', path }, anonIp);
    const anonRows = await q<{ n: number }>(
      `select count(*)::int as n from public.submit_rate_buckets where bucket_key like '%10.5.2.1%'`,
    );
    check(
      'no Bearer is 401 and writes no rate row',
      anon.status === 401 && anonRows[0]!.n === 0,
      `status=${anon.status} rows=${anonRows[0]!.n}`,
    );
    await clearRates('%10.5.%');
    await clearRates(`%${OWNER_X}%`);
  }
}

/* ---------- latency (BEFORE and AFTER) ---------- */

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function timed(n: number, fn: (i: number) => Response | Promise<Response>, expect: number) {
  const ms: number[] = [];
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await fn(i);
    await res.arrayBuffer();
    ms.push(performance.now() - t0);
    if (res.status !== expect) bad += 1;
  }
  return { p50: pct(ms, 50), p95: pct(ms, 95), bad };
}

async function latency() {
  const table: Array<[string, { p50: number; p95: number; bad: number }]> = [];
  // Warm the pools and the compute.
  await submit('10.9.9.9');
  await signUpload('10.9.9.9', 1000);
  await clearRates('%10.9.9.9%');

  table.push([
    'accepted submit (200 IPs)',
    await timed(200, (i) => submit(`10.6.${i >> 8}.${i & 255}`), 200),
  ]);

  const denyIp = '10.7.0.1';
  const now = new Date().toISOString();
  for (const [key, count] of [
    [`ipform:${denyIp}:${FORM_X}`, 1000],
    [`ip:${denyIp}`, 1000],
    [`sub:ipowner:${denyIp}:${OWNER_X}`, 1_000_000],
    [`sub:ip:${denyIp}`, 1_000_000],
  ] as const) {
    await q(
      `insert into public.submit_rate_buckets (bucket_key, window_started_at, hit_count) values ($1, $2, $3)
       on conflict (bucket_key) do update set window_started_at = excluded.window_started_at, hit_count = excluded.hit_count`,
      [key, now, count],
    );
  }
  table.push(['denied submit', await timed(200, () => submit(denyIp), 429)]);
  table.push([
    'wrong unlock (100 IPs)',
    await timed(100, (i) => unlock(`10.8.0.${i}`, { password: `wrong-${i}` }), 401),
  ]);
  table.push([
    'public sign (200 IPs)',
    await timed(200, (i) => signUpload(`10.10.${i >> 8}.${i & 255}`, 450_000), 200),
  ]);

  console.log('\nLATENCY (ms, in-process app → branch)');
  for (const [name, r] of table) {
    console.log(
      `  ${name.padEnd(28)} p50 ${r.p50.toFixed(1).padStart(7)}  p95 ${r.p95.toFixed(1).padStart(7)}  unexpected=${r.bad}`,
    );
  }
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.6.%' or bucket_key like '%10.7.%'
           or bucket_key like '%10.8.%' or bucket_key like '%10.10.%'`);
  return table;
}

async function main() {
  console.log(`[harness] MODE=${MODE} APP_DIR=${APP_DIR}`);
  await seed();
  submitApp = (await import(`${APP_DIR}/submit-response/index.ts`)).default as App;
  signApp = (await import(`${APP_DIR}/storage-sign/index.ts`)).default as App;

  if (MODE === 'full') await scenarios();
  const table = await latency();

  if (MODE === 'full') {
    await q('select pg_stat_clear_snapshot()');
    const st = await tableStats();
    console.log(
      `\nsubmit_rate_buckets: n_tup_ins=${st.n_tup_ins} n_tup_upd=${st.n_tup_upd} n_tup_hot_upd=${st.n_tup_hot_upd} n_dead_tup=${st.n_dead_tup}`,
    );
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  console.log(`LATENCY_JSON ${JSON.stringify(Object.fromEntries(table))}`);
  await db.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[harness] failed:', err instanceof Error ? err.message : err);
  await db.end().catch(() => {});
  process.exit(1);
});
