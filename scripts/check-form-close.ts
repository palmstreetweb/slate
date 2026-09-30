/**
 * Branch harness for ADR-063 (closing a form, the response cap, per-type answer clamps): applies
 * 019 to a THROWAWAY Neon branch, runs the REAL submitresponse Hono app in-process against it, and
 * prints a pass/fail line per scenario plus the count's query plan and submit latency. Tries 019's
 * rollback block and re-applies 019 at the end. Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-form-close.ts
 *
 * DATABASE_URL must never be production: the host must not contain PROD_ENDPOINT (default
 * ep-misty-snow). Seeds owners u_s19_* and forms f_s19*; each scenario uses its own
 * X-Forwarded-For range. Cleans up after itself (the branch is deleted afterwards anyway).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

type App = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

const PROD_ENDPOINT = process.env.PROD_ENDPOINT || 'ep-misty-snow';

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
const db = new pg.Pool({ connectionString: DB_URL, max: 8 });
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

const OWNER = 'u_s19_owner';
const STRANGER = 'u_s19_stranger';
const F = {
  open: 'f_s19open00001',
  dated: 'f_s19date00001',
  capped: 'f_s19capd00001',
  locked: 'f_s19lock00001',
  big: 'f_s19bigg00001',
};
const SLUG: Record<keyof typeof F, string> = {
  open: '',
  dated: '',
  capped: '',
  locked: '',
  big: '',
};
const schema = {
  brand: { name: 'Harness brand' },
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    {
      id: 'src',
      type: 'single_choice',
      title: 'Where?',
      allowOther: true,
      options: [{ label: 'Flyer', value: 'flyer' }],
    },
    { id: 'n', type: 'number', title: 'How many?' },
    { id: 'when', type: 'date', title: 'When?', range: true, includeTime: true },
  ],
};

async function asRole(
  role: 'authenticated' | 'anonymous',
  sub: string | null,
  sql: string,
  params: unknown[],
) {
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
    return r;
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

async function sqlError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'error';
  }
}

const taken = new Set<string>();
function slug8(): string {
  for (;;) {
    const s = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
}

async function applyFile(name: string) {
  await db.query(readFileSync(resolve('neon/migrations', name), 'utf8'));
}

function rollbackSql(): string {
  const text = readFileSync(resolve('neon/migrations/019_form_close.sql'), 'utf8');
  const block = text.slice(text.indexOf('-- Rollback'));
  return block
    .split('\n')
    .filter((l) => l.startsWith('--   '))
    .map((l) => l.slice(5))
    .filter((l) => !l.startsWith('then:'))
    .join('\n');
}

async function cleanup() {
  await q(`delete from public.submissions where form_id like 'f_s19%'`);
  await q(`delete from public.forms where id like 'f_s19%'`);
  await q(`delete from public.retired_slugs where owner_id like 'u_s19%'`).catch(() => {});
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.19.%'`).catch(
    () => {},
  );
  await q(`delete from public.slug_miss_buckets where ip_key like '10.19.%'`).catch(() => {});
}

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  await cleanup();
  for (const [k, id] of Object.entries(F) as Array<[keyof typeof F, string]>) {
    SLUG[k] = slug8();
    await asRole(
      'authenticated',
      OWNER,
      `insert into public.forms (id, name, slug, schema, published_schema, status)
       values ($1, $2, $3, $4::jsonb, $4::jsonb, 'published')`,
      [id, `Harness ${k}`, SLUG[k], JSON.stringify(schema)],
    );
  }
  await q(
    `update public.forms set fill_password_hash = crypt('harness-pass-1', gen_salt('bf', 8)) where id = $1`,
    [F.locked],
  );
}

/* ---------- reporting ---------- */

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

let app: App;
const meta = (src?: string) => ({
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 60_000,
  questionsVisited: ['name'],
  hiddenFields: src ? { src } : {},
});
const submit = (
  formId: string,
  ip: string,
  answers: Record<string, unknown> = { name: 'Ada' },
  src?: string,
) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ formId, answers, meta: meta(src) }),
  });
const lookup = (slug: string, ip: string) =>
  app.request(`/?op=form&slug=${slug}`, { method: 'GET', headers: { 'X-Forwarded-For': ip } });

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const liveCount = async (formId: string) =>
  (
    await q<{ n: number }>(
      `select count(*)::int as n from public.submissions where form_id = $1 and deleted_at is null`,
      [formId],
    )
  )[0]!.n;

/* ---------- scenarios ---------- */

async function schemaScenarios() {
  const cols = await q<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'forms'
        and column_name in ('closes_at', 'max_responses', 'closed_message', 'tracked_sources')
      order by column_name`,
  );
  check(
    '019 adds the four forms columns',
    cols.map((c) => `${c.column_name}:${c.data_type}`).join(',') ===
      'closed_message:text,closes_at:timestamp with time zone,max_responses:integer,tracked_sources:jsonb',
    cols.map((c) => c.column_name).join(','),
  );

  const upd = (set: string, params: unknown[] = []) =>
    asRole('authenticated', OWNER, `update public.forms set ${set} where id = $1`, [
      F.open,
      ...params,
    ]);
  check('max_responses 0 is refused', (await sqlError(() => upd('max_responses = 0'))) === '23514');
  check(
    'max_responses 10001 is refused',
    (await sqlError(() => upd('max_responses = 10001'))) === '23514',
  );
  check(
    'closed_message over 500 characters is refused',
    (await sqlError(() => upd('closed_message = $2', ['x'.repeat(501)]))) === '23514',
  );
  check(
    'tracked_sources must be a small array',
    (await sqlError(() => upd(`tracked_sources = '{"a":1}'::jsonb`))) === '23514' &&
      (await sqlError(() =>
        upd(`tracked_sources = (select jsonb_agg(i) from generate_series(1, 51) i)`),
      )) === '23514',
  );
  const ownerSet = await asRole(
    'authenticated',
    OWNER,
    `update public.forms set closes_at = now() + interval '1 day', max_responses = 5,
            closed_message = 'Thanks!', tracked_sources = '[{"name":"Mailbox flyer","src":"mailbox-flyer"}]'::jsonb
      where id = $1`,
    [F.open],
  );
  check(
    'the owner can set the close settings on their form (Data API role, RLS)',
    ownerSet.rowCount === 1,
  );
  const strangerSet = await asRole(
    'authenticated',
    STRANGER,
    `update public.forms set closes_at = now() - interval '1 day' where id = $1`,
    [F.open],
  );
  check("another account can't touch them (0 rows)", strangerSet.rowCount === 0);
  const anonRead = await asRole(
    'anonymous',
    null,
    `select closes_at from public.forms where id = $1`,
    [F.open],
  ).catch((e: { code?: string }) => ({ rowCount: -1, code: e.code }));
  check('anonymous reads nothing from forms', anonRead.rowCount === 0 || anonRead.rowCount === -1);
  await q(
    `update public.forms set closes_at = null, max_responses = null, closed_message = null where id = $1`,
    [F.open],
  );

  for (const role of ['anonymous', 'authenticated'] as const) {
    const code = await sqlError(() =>
      asRole(
        role,
        role === 'authenticated' ? OWNER : null,
        `select * from public.insert_public_submission('s_x', $1, '{}'::jsonb, '{}'::jsonb)`,
        [F.open],
      ),
    );
    check(`${role} cannot call insert_public_submission`, code === '42501', String(code));
  }
}

async function functionScenarios() {
  // Open form: schema served, submit stored with the source.
  {
    const res = await lookup(SLUG.open, '10.19.1.1');
    const b = await body(res);
    check(
      'op=form on an open form returns its schema, no closed field',
      res.status === 200 && !!b.schema && !('closed' in b),
    );
    const s = await submit(F.open, '10.19.1.2', { name: 'Ada' }, 'mailbox-flyer');
    const [row] = await q<{ meta: { hiddenFields: Record<string, string> } }>(
      `select meta from public.submissions where form_id = $1`,
      [F.open],
    );
    check(
      'submit on an open form: 200, source kept in meta.hiddenFields',
      s.status === 200 && row?.meta.hiddenFields.src === 'mailbox-flyer',
    );
  }

  // Closing time.
  {
    await q(
      `update public.forms set closes_at = now() - interval '1 minute', closed_message = 'See you next summer' where id = $1`,
      [F.dated],
    );
    const res = await lookup(SLUG.dated, '10.19.2.1');
    const b = await body(res);
    check(
      'op=form past closes_at: closed (date) with the owner message, no schema',
      res.status === 200 &&
        b.schema === null &&
        JSON.stringify(b.closed) ===
          JSON.stringify({ reason: 'date', message: 'See you next summer' }),
      JSON.stringify(b.closed),
    );
    const before = await q(`select count(*)::int as n from public.submit_rate_buckets`);
    const s = await submit(F.dated, '10.19.2.2');
    const sb = await body(s);
    const after = await q(`select count(*)::int as n from public.submit_rate_buckets`);
    check(
      'submit past closes_at: 410, nothing stored, nothing charged',
      s.status === 410 &&
        sb.reason === 'date' &&
        sb.message === 'See you next summer' &&
        (await liveCount(F.dated)) === 0 &&
        JSON.stringify(before) === JSON.stringify(after),
      `status ${s.status}`,
    );
    await q(`update public.forms set closes_at = now() + interval '1 hour' where id = $1`, [
      F.dated,
    ]);
    const reopened = await submit(F.dated, '10.19.2.3');
    check(
      'moving closes_at to the future reopens it at once (no republish)',
      reopened.status === 200,
    );
  }

  // Cap: exact under concurrency.
  {
    await q(`update public.forms set max_responses = 10 where id = $1`, [F.capped]);
    const statuses = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        submit(F.capped, `10.19.3.${i + 1}`).then(async (r) => {
          await r.arrayBuffer().catch(() => {});
          return r.status;
        }),
      ),
    );
    const ok = statuses.filter((s) => s === 200).length;
    const full = statuses.filter((s) => s === 409).length;
    const stored = await liveCount(F.capped);
    check(
      '30 concurrent submits at a cap of 10 store exactly 10 (advisory lock)',
      ok === 10 && full === 20 && stored === 10,
      `200×${ok} 409×${full} stored ${stored}`,
    );
    const b = await body(await lookup(SLUG.capped, '10.19.3.200'));
    check(
      'op=form at the cap: closed (full), no schema',
      b.schema === null && (b.closed as { reason?: string })?.reason === 'full',
    );
    await q(
      `update public.submissions set deleted_at = now()
        where id = (select id from public.submissions where form_id = $1 and deleted_at is null limit 1)`,
      [F.capped],
    );
    const again = await submit(F.capped, '10.19.3.201');
    check(
      'trashing a response frees its spot',
      again.status === 200 && (await liveCount(F.capped)) === 10,
    );
    const over = await submit(F.capped, '10.19.3.202');
    check('...and the next one is refused again', over.status === 409);
  }

  // Locked + closed: closed wins, no bcrypt.
  {
    await q(`update public.forms set closes_at = now() - interval '1 minute' where id = $1`, [
      F.locked,
    ]);
    const b = await body(await lookup(SLUG.locked, '10.19.4.1'));
    check(
      'a locked, closed form reports closed (locked stays true, no schema)',
      b.locked === true && b.schema === null && !!b.closed,
    );
    const t0 = performance.now();
    const u = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.19.4.2' },
      body: JSON.stringify({ op: 'unlock', slug: SLUG.locked, password: 'wrong-password' }),
    });
    const ub = await body(u);
    check(
      'unlock on a closed form answers closed without a password check',
      u.status === 200 && !!ub.closed && ub.schema === null,
      `${Math.round(performance.now() - t0)} ms`,
    );
  }

  // Per-type clamps.
  {
    const s = await submit(F.open, '10.19.5.1', {
      name: 'Ada',
      src: 'y'.repeat(900),
      n: '12',
      when: '2026-10-03T09:00/2026-10-03T17:00',
    });
    const [row] = await q<{ answers: Record<string, unknown> }>(
      `select answers from public.submissions where form_id = $1 order by received_at desc limit 1`,
      [F.open],
    );
    check(
      'per-type clamps: Other text capped at 500, numeric text → number, date range kept',
      s.status === 200 &&
        (row!.answers.src as string).length === 500 &&
        row!.answers.n === 12 &&
        row!.answers.when === '2026-10-03T09:00/2026-10-03T17:00',
    );
  }
}

async function planAndLatency() {
  // A form with 20,000 live and 5,000 trashed responses, so the planner has a reason to use the index.
  await q(
    `insert into public.submissions (id, form_id, answers, meta, received_at, deleted_at)
     select 's_s19_' || i, $1, '{}'::jsonb, '{}'::jsonb, now(), case when i % 5 = 0 then now() end
       from generate_series(1, 25000) i`,
    [F.big],
  );
  await q('analyze public.submissions');
  await q('vacuum (analyze) public.submissions').catch(() => {});
  const plan = (
    await q<{ 'QUERY PLAN': string }>(
      `explain (analyze, costs off) select count(*) from public.submissions s
        where s.form_id = $1 and s.deleted_at is null`,
      [F.big],
    )
  )
    .map((r) => r['QUERY PLAN'])
    .join('\n');
  console.log(`\nCOUNT PLAN (${F.big}, 20,000 live of 25,000)\n${plan}\n`);
  check(
    'the live count uses submissions_form_live_idx',
    /Index Only Scan using submissions_form_live_idx/.test(plan),
  );

  await q(`update public.forms set max_responses = 10000 where id = $1`, [F.big]);
  const full = await body(await lookup(SLUG.big, '10.19.6.1'));
  check(
    '20,000 live at a cap of 10,000 reads as full',
    (full.closed as { reason?: string })?.reason === 'full',
  );

  const time = async (formId: string, prefix: string, n = 40) => {
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      const r = await submit(formId, `${prefix}.${i + 1}`);
      await r.arrayBuffer().catch(() => {});
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return { p50: ms[Math.floor(n / 2)]!, p95: ms[Math.floor(n * 0.95)]! };
  };
  await q(`update public.forms set max_responses = null, closes_at = null where id = $1`, [F.open]);
  const open = await time(F.open, '10.19.7');
  await q(`update public.forms set max_responses = 1000 where id = $1`, [F.open]);
  const capped = await time(F.open, '10.19.8');
  console.log('\nSUBMIT LATENCY (ms, laptop → branch, real app in-process)');
  console.log(`  no cap       p50 ${open.p50.toFixed(1)}  p95 ${open.p95.toFixed(1)}`);
  console.log(`  cap of 1000  p50 ${capped.p50.toFixed(1)}  p95 ${capped.p95.toFixed(1)}`);
}

async function rollbackRoundTrip() {
  await db.query(rollbackSql());
  const [gone] = await q<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'forms'
        and column_name in ('closes_at', 'max_responses', 'closed_message', 'tracked_sources')`,
  );
  const [fn] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
  );
  check('019 rollback block removes the columns, index and function', gone!.n === 0 && fn!.n === 0);
  await applyFile('019_form_close.sql');
  const [back] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
  );
  check('019 re-applies after a rollback', back!.n === 1);
}

async function main() {
  console.log('[harness] applying 019 twice (idempotent)');
  await applyFile('019_form_close.sql');
  await applyFile('019_form_close.sql');
  await seed();
  process.env.DATABASE_URL = DB_URL;
  app = (await import(resolve('neon/functions/submit-response/index.ts'))).default as App;
  await schemaScenarios();
  await functionScenarios();
  await planAndLatency();
  await cleanup();
  await rollbackRoundTrip();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  await db.end();
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[harness] failed:', err instanceof Error ? err.message : err);
  await cleanup().catch(() => {});
  await db.end().catch(() => {});
  process.exit(1);
});
