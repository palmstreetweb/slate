/**
 * Branch harness for ADR-072 (new-response emails, migration 023): applies 023 to a THROWAWAY Neon
 * branch of production, then proves as the Data API's roles (set local role + JWT claims, the way
 * PostgREST runs) that only the owner can turn a form's emails on, that the database owns
 * notify_since, and that a form save leaves the switch alone; then runs the REAL notifysend Hono app
 * in-process against the branch (Resend is a stubbed fetch) and checks what it sends, to whom, and
 * what it skips: the 15-minute window, trashed responses and forms, unverified owners, a failed send's
 * backoff, the signed unsubscribe. Runs 023's rollback block and re-applies 023. Not part of `npm test`.
 *
 *   npx vite-node scripts/check-response-email.ts
 *       creates branch notify-<time> from production, runs, and DELETES it at the end, failed or not.
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-response-email.ts
 *       runs against an existing throwaway branch (not deleted).
 *
 * The host must never be production (PROD_ENDPOINT, default ep-misty-snow-ax9wxjvf): asserted
 * before any write. The connection string and the branch's credentials are never printed.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const PROJECT = process.env.NEON_PROJECT_ID || 'odd-voice-53972178';
const PROD_ENDPOINT = process.env.PROD_ENDPOINT || 'ep-misty-snow-ax9wxjvf';
const SECRET = 'harness-secret-'.padEnd(48, 'x');

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
  const name = `notify-${Date.now()}`;
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
    return { rows: [], error: { code: e.code, message: e.message } };
  } finally {
    c.release();
  }
}

function migrationSql(): string {
  return readFileSync(resolve('neon/migrations/023_response_email.sql'), 'utf8');
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- people and forms ---------- */

const OWNER = randomUUID();
const UNVERIFIED = randomUUID();
const STRANGER = randomUUID();
const OWNER_EMAIL = `notify-harness-${OWNER.slice(0, 8)}@example.com`;
const schema = { brand: { name: 'Harness' }, questions: [{ id: 'q', type: 'short_text' }] };
const F = {
  main: 'f_s23main00001',
  trashed: 'f_s23trsh00001',
  unverified: 'f_s23unvf00001',
  failing: 'f_s23fail00001',
};

async function seed() {
  for (const [id, verified] of [
    [OWNER, true],
    [UNVERIFIED, false],
    [STRANGER, true],
  ] as const) {
    await q(
      `insert into neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Harness', $2, $3, now(), now())`,
      [id, id === OWNER ? OWNER_EMAIL : `h-${id.slice(0, 8)}@example.com`, verified],
    );
  }
  for (const [id, owner, name] of [
    [F.main, OWNER, 'Roof estimate'],
    [F.trashed, OWNER, 'Trashed one'],
    [F.unverified, UNVERIFIED, 'Unverified owner'],
    [F.failing, OWNER, 'Failing one'],
  ] as const) {
    const r = await asRole(
      'authenticated',
      owner,
      `insert into public.forms (id, name, slug, schema, status) values ($1, $2, null, $3::jsonb, 'draft')`,
      [id, name, JSON.stringify(schema)],
    );
    if (r.error) throw new Error(`seed ${id}: ${r.error.message}`);
  }
}

async function addResponses(formId: string, n: number, deleted = false) {
  for (let i = 0; i < n; i++) {
    await q(
      `insert into public.submissions (id, form_id, answers, meta, received_at, deleted_at)
       values ($1, $2, '{}'::jsonb, '{}'::jsonb, now(), $3)`,
      [`s_${randomUUID().slice(0, 12)}`, formId, deleted ? new Date().toISOString() : null],
    );
  }
}

/* ---------- scenarios ---------- */

async function switchRules() {
  const on = await asRole(
    'authenticated',
    OWNER,
    `select public.set_form_notify_email($1, true) as v`,
    [F.main],
  );
  const [row] = await q<{ notify_email: boolean; notify_since: Date | null }>(
    `select notify_email, notify_since from public.forms where id = $1`,
    [F.main],
  );
  check(
    'the owner turns emails on; the database stamps notify_since',
    !on.error && row?.notify_email === true && row.notify_since !== null,
    on.error?.message ?? '',
  );

  const stranger = await asRole(
    'authenticated',
    STRANGER,
    `select public.set_form_notify_email($1, true)`,
    [F.trashed],
  );
  check(
    'a stranger cannot turn someone else’s emails on',
    stranger.error?.code === '42501',
    stranger.error?.code ?? 'no error',
  );

  const anon = await asRole('anonymous', null, `select public.set_form_notify_email($1, true)`, [
    F.main,
  ]);
  check(
    'anonymous cannot call set_form_notify_email',
    anon.error?.code === '42501',
    anon.error?.code ?? 'no error',
  );

  const before = row!.notify_since!.toISOString();
  const moved = await asRole(
    'authenticated',
    OWNER,
    `update public.forms set notify_since = now() - interval '30 days', name = 'Roof estimate' where id = $1`,
    [F.main],
  );
  const [after] = await q<{ notify_since: Date; notify_email: boolean }>(
    `select notify_since, notify_email from public.forms where id = $1`,
    [F.main],
  );
  check(
    'a form save (and a forged notify_since) leaves the switch and the stamp alone',
    !moved.error && after!.notify_email === true && after!.notify_since.toISOString() === before,
    moved.error?.message ?? '',
  );

  for (const id of [F.trashed, F.failing]) {
    await asRole('authenticated', OWNER, `select public.set_form_notify_email($1, true)`, [id]);
  }
  await asRole('authenticated', UNVERIFIED, `select public.set_form_notify_email($1, true)`, [
    F.unverified,
  ]);

  for (const table of ['response_email_state', 'response_email_owner_day']) {
    const r = await asRole('authenticated', OWNER, `select * from public.${table}`);
    check(
      `authenticated cannot read ${table}`,
      r.error?.code === '42501',
      r.error?.code ?? `${r.rows.length} rows`,
    );
  }
  const due = await asRole('authenticated', OWNER, `select * from public.response_emails_due(25)`);
  check(
    'authenticated cannot call response_emails_due',
    due.error?.code === '42501',
    due.error?.code ?? 'no error',
  );
}

type Sent = { to: string[]; subject: string; html: string; headers: Record<string, string> };
const sent: Sent[] = [];
let failNext = 0;

async function runFunction() {
  process.env.RESEND_API_KEY = 're_harness';
  process.env.UNSUB_SECRET = SECRET;
  process.env.NOTIFY_PUBLIC_URL = 'https://notify.harness.example';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== 'https://api.resend.com/emails') return realFetch(input, init);
    const body = JSON.parse(String(init?.body)) as Sent;
    if (failNext > 0 && body.subject.includes('Failing')) {
      failNext -= 1;
      return new Response('{"message":"harness failure"}', { status: 500 });
    }
    sent.push(body);
    return new Response('{"id":"e_harness"}', { status: 200 });
  }) as typeof fetch;

  const app = (await import('../neon/functions/notify-send/index.js')).default as {
    request: (path: string, init?: RequestInit) => Promise<Response>;
  };
  const run = async () => {
    const res = await app.request('/run', {
      method: 'POST',
      headers: {
        'x-neon-trigger-invocation-id': `inv-${Date.now()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ data: { scheduled_at: new Date().toISOString() } }),
    });
    return (await res.json()) as Record<string, unknown>;
  };

  const first = await run();
  check(
    'no responses yet: nothing is due',
    first.due === 0 && sent.length === 0,
    JSON.stringify(first),
  );

  await addResponses(F.main, 2);
  await addResponses(F.main, 1, true); // trashed: not counted
  await addResponses(F.trashed, 1);
  await q(`update public.forms set deleted_at = now() where id = $1`, [F.trashed]);
  await addResponses(F.unverified, 1);
  await addResponses(F.failing, 1);
  failNext = 1;

  const early = await run();
  check('a response younger than the 10 s settle waits', early.due === 0, JSON.stringify(early));

  await sleep(11_000);
  const second = await run();
  const main = sent.find((s) => s.subject.includes('Roof estimate'));
  check(
    'one email to the owner’s verified address, counting live responses only',
    main?.to.join() === OWNER_EMAIL && main.subject === '2 new responses on “Roof estimate”',
    main ? `${main.to.join()} · ${main.subject}` : JSON.stringify(second),
  );
  check(
    'no email for a trashed form or an unverified owner',
    !sent.some((s) => /Trashed one|Unverified owner/.test(s.subject)),
    sent.map((s) => s.subject).join(' | '),
  );
  check(
    'the email carries the one-click unsubscribe headers',
    Boolean(
      main?.headers['List-Unsubscribe']?.startsWith(
        '<https://notify.harness.example/unsubscribe?t=f_s23main00001.',
      ),
    ) && main?.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
  );
  check(
    'the email has no answers in it, only a link',
    Boolean(main?.html.includes(`/forms/${F.main}/submissions`)),
  );

  const [failState] = await q<{
    fail_count: number;
    next_try_at: Date | null;
    notified_upto: Date | null;
  }>(
    `select fail_count, next_try_at, notified_upto from public.response_email_state where form_id = $1`,
    [F.failing],
  );
  check(
    'a failed send keeps the cursor and backs off',
    failState?.fail_count === 1 &&
      failState.notified_upto === null &&
      (failState.next_try_at?.getTime() ?? 0) > Date.now(),
    JSON.stringify(failState),
  );
  const [day] = await q<{ sent: number }>(
    `select sent from public.response_email_owner_day where owner_id = $1`,
    [OWNER],
  );
  check('the owner’s day count went up by one', day?.sent === 1, JSON.stringify(day));

  await addResponses(F.main, 1);
  await sleep(11_000);
  const count = sent.length;
  const third = await run();
  check(
    'inside the 15-minute window a new response waits for the next email',
    sent.length === count,
    JSON.stringify(third),
  );

  await q(
    `update public.response_email_state set last_sent_at = now() - interval '16 minutes' where form_id = $1`,
    [F.main],
  );
  await run();
  const later = sent.at(-1);
  check(
    'after the window, the next email counts only what came since',
    later?.subject === '1 new response on “Roof estimate”',
    later?.subject ?? 'none',
  );

  // Unsubscribe with the link from the email.
  const link = main!.headers['List-Unsubscribe']!.slice(1, -1);
  const path = link.replace('https://notify.harness.example', '');
  const get = await app.request(path);
  const [stillOn] = await q<{ notify_email: boolean }>(
    `select notify_email from public.forms where id = $1`,
    [F.main],
  );
  check(
    'opening the unsubscribe link only asks',
    get.status === 200 && stillOn?.notify_email === true,
  );
  const post = await app.request(path, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
  const [off] = await q<{ notify_email: boolean; notify_since: Date | null }>(
    `select notify_email, notify_since from public.forms where id = $1`,
    [F.main],
  );
  check(
    'one-click POST turns that form’s emails off',
    post.status === 200 && off?.notify_email === false && off.notify_since === null,
  );
  const forged = await app.request(path.replace(/\.[A-Za-z0-9_-]+$/, `.${'A'.repeat(43)}`), {
    method: 'POST',
  });
  check('a forged token is refused', forged.status === 400);

  globalThis.fetch = realFetch;
}

async function rollbackAndReapply() {
  await db.query(rollbackSql());
  const [gone] = await q<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'forms' and column_name in ('notify_email', 'notify_since')`,
  );
  const [fns] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname like 'response_email%' or proname = 'set_form_notify_email'`,
  );
  check(
    '023 rollback block removes the columns, tables and functions',
    gone!.n === 0 && fns!.n === 0,
    `${gone!.n} cols, ${fns!.n} fns`,
  );
  await db.query(migrationSql());
  await db.query(migrationSql());
  const [back] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'response_emails_due'`,
  );
  check('023 re-applies (twice: idempotent)', back!.n === 1);
}

async function cleanup() {
  await q(`delete from public.submissions where form_id = any($1)`, [Object.values(F)]);
  await q(`delete from public.forms where id = any($1)`, [Object.values(F)]);
  await q(`delete from public.response_email_owner_day where owner_id = any($1)`, [
    [OWNER, UNVERIFIED, STRANGER],
  ]);
  await q(`delete from neon_auth."user" where id = any($1::uuid[])`, [
    [OWNER, UNVERIFIED, STRANGER],
  ]);
}

async function main() {
  try {
    const url = branchUrl();
    assertNotProduction(url);
    process.env.DATABASE_URL = url;
    db = new pg.Pool({ connectionString: url, max: 6 });
    console.log('[harness] connected to the branch; applying 023');
    await db.query(migrationSql());
    await seed();
    await switchRules();
    await runFunction();
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
  deleteBranch();
  process.exit(1);
});
