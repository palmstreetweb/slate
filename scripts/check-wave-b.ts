/**
 * Branch harness for ADR-064 (Wave B: instant estimate, contact / address /
 * signature answers): runs the REAL submitresponse Hono app in-process
 * against a THROWAWAY Neon branch and prints a pass/fail line per scenario,
 * plus submit latency with and without an estimate to compute. Needs 019
 * (applied here, idempotently). No migration of its own. Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-wave-b.ts
 *
 * DATABASE_URL must never be production: the host must not contain
 * PROD_ENDPOINT (default ep-misty-snow). Seeds owner u_s64_* and forms
 * f_s64*; every scenario uses its own X-Forwarded-For range. Cleans up after
 * itself (the branch is deleted afterwards anyway).
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

const OWNER = 'u_s64_owner';
const F = { quote: 'f_s64quote0001', plain: 'f_s64plain0001' };
const SLUG = { quote: '', plain: '' };

const outside = { field: 'addr', op: 'equals', value: '__out_of_area__' };
const quoteSchema = {
  brand: { name: 'Harness roofing' },
  estimate: { base: 150, baseLabel: 'Inspection visit', currency: 'USD', breakdown: true },
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hi' },
    {
      id: 'plan',
      type: 'single_choice',
      title: 'Package',
      display: 'cards',
      options: [
        { label: 'Repair', value: 'repair', price: 450, priceMax: 900, features: ['Photo report'] },
        { label: 'Restore', value: 'restore', price: 3200, priceMax: 4100, badge: 'Most popular' },
      ],
    },
    {
      id: 'sky',
      type: 'number',
      title: 'Skylights',
      display: 'stepper',
      min: 0,
      max: 12,
      unit: 'skylights',
      unitPrice: 180,
      unitPriceMax: 240,
    },
    { id: 'who', type: 'contact_info', title: 'Reach you?', fields: { phone: 'required' } },
    {
      id: 'addr',
      type: 'address',
      title: 'Where?',
      required: true,
      serviceArea: ['931'],
      logic: [{ if: outside, goTo: 'sorry' }],
    },
    { id: 'sig', type: 'signature', title: 'Sign', required: true },
    { id: 'sig2', type: 'signature', title: 'Initial', allowTyped: false },
    { id: 'sorry', type: 'thanks', title: 'Out of area', visibleIf: outside },
    { id: 'done', type: 'thanks', title: 'Thanks', showEstimate: true },
  ],
};
const plainSchema = {
  brand: { name: 'Harness plain' },
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
};

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

async function asOwner(sql: string, params: unknown[]) {
  const c = await db.connect();
  try {
    await c.query('select auth.user_id()'); // pg_session_jwt warm-up as neondb_owner
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: OWNER, role: 'authenticated' }),
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

async function cleanup() {
  await q(`delete from public.submissions where form_id like 'f_s64%'`);
  await q(`delete from public.forms where id like 'f_s64%'`);
  await q(`delete from public.retired_slugs where owner_id like 'u_s64%'`).catch(() => {});
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.64.%'`).catch(
    () => {},
  );
  await q(`delete from public.slug_miss_buckets where ip_key like '10.64.%'`).catch(() => {});
}

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  await cleanup();
  for (const [k, schema] of [
    ['quote', quoteSchema],
    ['plain', plainSchema],
  ] as const) {
    SLUG[k] = slug8();
    // Through the Data API role, as the studio writes it (RLS, triggers).
    await asOwner(
      `insert into public.forms (id, name, slug, schema, published_schema, status)
       values ($1, $2, $3, $4::jsonb, $4::jsonb, 'published')`,
      [F[k], `Harness ${k}`, SLUG[k], JSON.stringify(schema)],
    );
  }
}

/** Deep equality that ignores key order (jsonb stores keys in its own order). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

let app: App;
const meta = (extra: Record<string, unknown> = {}) => ({
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 60_000,
  questionsVisited: ['plan'],
  hiddenFields: {},
  score: 0,
  ...extra,
});
const submit = (
  formId: string,
  ip: string,
  answers: Record<string, unknown>,
  extraMeta: Record<string, unknown> = {},
) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ formId, answers, meta: meta(extraMeta) }),
  });
const lookup = (slug: string, ip: string) =>
  app.request(`/?op=form&slug=${slug}`, { method: 'GET', headers: { 'X-Forwarded-For': ip } });

async function latest(formId: string) {
  const [row] = await q<{ answers: Record<string, unknown>; meta: Record<string, unknown> }>(
    `select answers, meta from public.submissions where form_id = $1 order by received_at desc limit 1`,
    [formId],
  );
  return row!;
}

const SIG = 'M40 150l20 -60 18 -30 14 10 -6 60 -8 20 10 -40 24 -40 14 20 -4 50 16 -40 30 -30';

async function scenarios() {
  // The published schema comes back with every Wave B option intact.
  {
    const res = await lookup(SLUG.quote, '10.64.1.1');
    const b = (await res.json()) as { schema?: typeof quoteSchema };
    const qs = b.schema?.questions ?? [];
    const plan = qs.find((x) => x.id === 'plan') as (typeof quoteSchema.questions)[1] | undefined;
    check(
      'op=form serves Wave B options as published (cards, prices, service area, estimate)',
      res.status === 200 &&
        plan?.display === 'cards' &&
        plan.options[1]?.badge === 'Most popular' &&
        (b.schema as { estimate?: { base?: number } })?.estimate?.base === 150 &&
        same(
          qs.find((x) => x.id === 'addr'),
          quoteSchema.questions[4],
        ),
    );
  }

  // The estimate is the server's own, not the browser's.
  {
    const s = await submit(
      F.quote,
      '10.64.2.1',
      {
        plan: 'restore',
        sky: 2,
        who: { name: ' Ada ', email: 'ada@example.com', phone: '+18055550100', x: 'y' },
        addr: { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' },
        sig: { path: SIG },
      },
      { estimate: { low: 1, high: 1, currency: 'USD', lines: [] } },
    );
    const row = await latest(F.quote);
    const e = row.meta.estimate as { low: number; high: number; lines: unknown[] } | undefined;
    check(
      'a forged client estimate is replaced by the server’s (base + package + 2 skylights)',
      s.status === 200 &&
        e?.low === 150 + 3200 + 360 &&
        e?.high === 150 + 4100 + 480 &&
        e.lines.length === 3,
      JSON.stringify(e && { low: e.low, high: e.high }),
    );
    check(
      'contact, address and signature are stored in their clamped shapes',
      same(row.answers.who, { name: 'Ada', email: 'ada@example.com', phone: '+18055550100' }) &&
        same(row.answers.addr, {
          street: '12 Palm St',
          city: 'Santa Barbara',
          region: 'CA',
          postal: '93101',
        }) &&
        (row.answers.sig as { path?: string })?.path === SIG,
    );
  }

  // Quantities past the question's max price nothing.
  {
    await submit(F.quote, '10.64.3.1', { plan: 'repair', sky: 5000 }, { estimate: { low: 9e8 } });
    const e = (await latest(F.quote)).meta.estimate as { low: number; high: number };
    check(
      'a quantity past the max adds nothing, whatever the client claims',
      e.low === 150 + 450 && e.high === 150 + 900,
      JSON.stringify(e),
    );
  }

  // Forged signatures are dropped; typing obeys the owner's switch.
  {
    await submit(F.quote, '10.64.4.1', {
      plan: 'repair',
      sig: { path: 'M0 0"/><script>alert(1)</script>' },
      sig2: { typed: 'Ada' },
    });
    const a = (await latest(F.quote)).answers;
    check(
      'markup in a signature path is dropped; typed on a draw-only signature is dropped',
      !('sig' in a) && !('sig2' in a) && a.plan === 'repair',
    );
    await submit(F.quote, '10.64.4.2', { sig: { typed: '  Ada Lovelace ' } });
    check(
      'a typed signature is kept, trimmed',
      same((await latest(F.quote)).answers.sig, { typed: 'Ada Lovelace' }),
    );
  }

  // The biggest signature the engine can write fits the body cap and is kept.
  {
    // 1,580 zig-zag segments: 7,906 characters, 1,581 points, all inside the box.
    const clean = `M0 100l${Array.from({ length: 1580 }, (_, i) => (i % 2 ? '-3 1' : '3 -1')).join(' ')}`;
    const s = await submit(F.quote, '10.64.5.1', { sig: { path: clean } });
    const stored = (await latest(F.quote)).answers.sig as { path?: string } | undefined;
    check(
      'a signature near the 8,000-character cap is accepted and stored whole',
      s.status === 200 && stored?.path === clean,
      `${clean.length} chars`,
    );
    const over = `M0 100l${'1 0 '.repeat(2100)}1 0`;
    await submit(F.quote, '10.64.5.2', { plan: 'repair', sig: { path: over } });
    check(
      'a path over the cap is dropped, the rest of the response kept',
      !('sig' in (await latest(F.quote)).answers),
      `${over.length} chars`,
    );
  }

  // Out of area is stored like any address; routing is the page's job.
  {
    await submit(F.quote, '10.64.6.1', {
      addr: { street: '1 Main St', city: 'Fresno', region: 'CA', postal: '93701' },
    });
    const row = await latest(F.quote);
    check(
      'an out-of-area address is stored (the owner sees the lead), base-only estimate',
      (row.answers.addr as { postal?: string })?.postal === '93701' &&
        (row.meta.estimate as { low?: number })?.low === 150,
    );
  }

  // No prices, no estimate.
  {
    await submit(
      F.plain,
      '10.64.7.1',
      { name: 'Ada' },
      { estimate: { low: 5, high: 5, currency: 'USD', lines: [] } },
    );
    check(
      'a form without prices stores no estimate, even when the client sends one',
      !('estimate' in (await latest(F.plain)).meta),
    );
  }

  // The owner reads it back through RLS as written.
  {
    const r = await asOwner(
      `select meta->'estimate'->>'low' as low from public.submissions where form_id = $1 order by received_at asc limit 1`,
      [F.quote],
    );
    check(
      'the owner reads the stored estimate through the Data API role (RLS)',
      (r.rows[0] as { low?: string })?.low === String(150 + 3200 + 360),
    );
  }
}

async function latency() {
  const time = async (formId: string, prefix: string, answers: Record<string, unknown>) => {
    const ms: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const r = await submit(formId, `${prefix}.${i + 1}`, answers);
      await r.arrayBuffer().catch(() => {});
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return { p50: ms[15]!, p95: ms[28]! };
  };
  const plain = await time(F.plain, '10.64.8', { name: 'Ada' });
  const quote = await time(F.quote, '10.64.9', {
    plan: 'restore',
    sky: 3,
    who: { name: 'Ada', email: 'ada@example.com', phone: '+18055550100' },
    addr: { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' },
    sig: { path: SIG },
  });
  console.log('\nSUBMIT LATENCY (ms, laptop → branch, real app in-process, 30 each)');
  console.log(`  no prices             p50 ${plain.p50.toFixed(1)}  p95 ${plain.p95.toFixed(1)}`);
  console.log(`  estimate + Wave B     p50 ${quote.p50.toFixed(1)}  p95 ${quote.p95.toFixed(1)}`);
}

async function main() {
  const [has019] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
  );
  if (!has019!.n) {
    console.log('[harness] applying 019 (Wave A) to the branch');
    await db.query(readFileSync(resolve('neon/migrations/019_form_close.sql'), 'utf8'));
  }
  await seed();
  process.env.DATABASE_URL = DB_URL;
  app = (await import(resolve('neon/functions/submit-response/index.ts'))).default as App;
  await scenarios();
  await latency();
  await cleanup();
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
