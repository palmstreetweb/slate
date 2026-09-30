/**
 * Branch harness for ADR-068 (a location stores only its in / out verdict by
 * default): runs the REAL submitresponse Hono app in-process against a
 * THROWAWAY Neon branch of production and prints a pass/fail line per
 * scenario, plus submit latency for a verdict-only and a kept location.
 * No migration. Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 npx vite-node scripts/check-location-privacy.ts
 *
 * It makes its own branch (`neonctl branches create --parent production`),
 * reads the branch's connection string into memory (never printed), refuses
 * to write unless the host is NOT production's endpoint (PROD_ENDPOINT,
 * default ep-misty-snow-ax9wxjvf), and deletes the branch at the end — on
 * failure and on Ctrl-C too. Set KEEP_BRANCH=1 to keep it for a look.
 *
 * Proves: by default a stored location has no coordinates, distance, ZIP or
 * typed place (anywhere in the row); a forged in-area verdict is still
 * corrected; a verdict sent without a position is dropped; `keepLocation:
 * true` keeps the rounded coordinates / ZIP / place as ADR-065 did; a
 * published schema without the option (an ADR-065 form) and a non-boolean
 * `keepLocation` are verdict-only; the lookup serves the option as published;
 * the owner reads the verdict through RLS.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

type App = { request: (path: string, init: RequestInit) => Response | Promise<Response> };

const PROJECT = process.env.NEON_PROJECT_ID || 'odd-voice-53972178';
const PROD_ENDPOINT = process.env.PROD_ENDPOINT || 'ep-misty-snow-ax9wxjvf';
const NEONCTL = ['-y', 'neonctl@latest'];

if (process.env.CONFIRM_BRANCH !== '1') {
  throw new Error('Set CONFIRM_BRANCH=1: this creates (and deletes) a Neon branch.');
}

/** neonctl through npx; stdout only, and never echoed (it can carry a password). */
function neonctl(args: string[]): string {
  return execFileSync('npx', [...NEONCTL, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });
}

let branchId: string | null = null;
let deleted = false;

function deleteBranch(): void {
  if (!branchId || deleted) return;
  if (process.env.KEEP_BRANCH === '1') {
    console.log(`[harness] KEEP_BRANCH=1: branch ${branchId} left in place`);
    return;
  }
  deleted = true;
  try {
    neonctl(['branches', 'delete', branchId, '--project-id', PROJECT]);
    console.log(`[harness] branch ${branchId} deleted`);
  } catch (err) {
    console.error(
      `[harness] could NOT delete branch ${branchId}; delete it by hand:`,
      err instanceof Error ? err.message.split('\n')[0] : err,
    );
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    deleteBranch();
    process.exit(130);
  });
}

function createBranch(): string {
  const name = `loc-privacy-${Date.now().toString(36)}`;
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
  ) as { branch?: { id?: string } };
  const id = out.branch?.id;
  if (!id || !/^br-[a-z0-9-]+$/.test(id)) throw new Error('neonctl did not return a branch id');
  branchId = id;
  console.log(`[harness] created branch ${name} (${id}) from production`);
  const url = neonctl([
    'connection-string',
    id,
    '--project-id',
    PROJECT,
    '--role-name',
    'neondb_owner',
  ]).trim();
  const host = new URL(url).hostname;
  // The one check that matters before any write: never production.
  if (!host || host.includes(PROD_ENDPOINT) || host.includes('ep-misty-snow')) {
    throw new Error('Refusing: the branch connection string points at production.');
  }
  console.log(`[harness] branch host is not production (${host.split('.')[0]})`);
  return url;
}

/* ---------- schemas ---------- */

const OWNER = 'u_s68_owner';
const F = {
  verdict: 'f_s68verdict01',
  kept: 'f_s68kept00001',
  legacy: 'f_s68legacy001',
  odd: 'f_s68oddkeep01',
};
const SLUG: Record<keyof typeof F, string> = { verdict: '', kept: '', legacy: '', odd: '' };
const SB = { lat: 34.4208, lng: -119.6982 };
const address = { id: 'addr', type: 'address', title: 'Address', serviceArea: ['931'] };
const done = { id: 'done', type: 'thanks', title: 'Thanks' };

const verdictSchema = {
  brand: { name: 'Harness verdict' },
  questions: [
    { id: 'where', type: 'location', title: 'Where?', center: SB, radius: 25, radiusUnit: 'mi' },
    { id: 'plain', type: 'location', title: 'No area' },
    address,
    done,
  ],
};
const keptSchema = {
  brand: { name: 'Harness kept' },
  questions: [
    {
      id: 'where',
      type: 'location',
      title: 'Where?',
      center: SB,
      radius: 25,
      radiusUnit: 'mi',
      keepLocation: true,
    },
    { id: 'plain', type: 'location', title: 'No area', keepLocation: true },
    address,
    done,
  ],
};
// Exactly as ADR-065 published a location, before the option existed.
const legacySchema = {
  brand: { name: 'Harness legacy' },
  questions: [
    {
      id: 'where',
      type: 'location',
      title: 'Where’s the job?',
      center: SB,
      radius: 25,
      radiusUnit: 'mi',
      privacyNote: 'We only use this to check that you’re in our service area.',
    },
    done,
  ],
};
const oddSchema = {
  brand: { name: 'Harness odd' },
  questions: [
    {
      id: 'where',
      type: 'location',
      title: 'Where?',
      center: SB,
      radius: 25,
      keepLocation: 'true',
    },
    done,
  ],
};

/* ---------- plumbing ---------- */

let db: pg.Pool;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

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

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  for (const [k, schema] of [
    ['verdict', verdictSchema],
    ['kept', keptSchema],
    ['legacy', legacySchema],
    ['odd', oddSchema],
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
const meta = () => ({
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 60_000,
  questionsVisited: ['where'],
  hiddenFields: {},
  score: 0,
});
const submit = (formId: string, ip: string, answers: Record<string, unknown>) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ formId, answers, meta: meta() }),
  });

/**
 * The newest stored row, whole (every column as JSON, minus timestamps, ids and
 * hashes, whose digits could look like a coordinate), and its answers.
 */
async function latest(formId: string) {
  const [row] = await q<{ answers: Record<string, unknown>; whole: string }>(
    `select s.answers, to_jsonb(s)::text as whole
       from public.submissions s where s.form_id = $1
      order by s.received_at desc limit 1`,
    [formId],
  );
  return {
    answers: row!.answers,
    whole: row!.whole
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}(?::?\d{2})?)?/g, '<time>')
      .replace(/"id": ?"[^"]*"/g, '"id":"<id>"')
      .replace(/[0-9a-f]{16,}/gi, '<hex>'),
  };
}

/**
 * Anything of a position in a stored row: the coordinates sent, a ZIP or a place typed, or
 * a lat / lng / zip / typed KEY (`"via": "zip"` is the verdict's own value, and fine).
 */
const POSITION = /34\.0[45]|118\.2[34]|34\.44|119\.81|90210|93105|Goleta|"(?:lat|lng|zip|typed)":/;

/* ---------- scenarios ---------- */

async function scenarios() {
  // Default: a forged "in" from Los Angeles is corrected, and nothing of the position is kept.
  {
    const s = await submit(F.verdict, '10.68.1.1', {
      where: { lat: 34.052235, lng: -118.243683, area: 'in' },
    });
    const r = await latest(F.verdict);
    check(
      'default: Los Angeles claiming "in" is stored { area: out, via: gps } only',
      s.status === 200 && same(r.answers.where, { area: 'out', via: 'gps' }),
      JSON.stringify(r.answers.where),
    );
    check(
      'default: no coordinates, distance or their keys anywhere in the stored row',
      !POSITION.test(r.whole) && !/distance|"km"|"mi"/i.test(r.whole),
    );
  }
  {
    await submit(F.verdict, '10.68.1.2', {
      where: { lat: '34.441234', lng: '-119.812345', area: 'out' },
    });
    const r = await latest(F.verdict);
    check(
      'default: Goleta claiming "out" is stored { area: in, via: gps }',
      same(r.answers.where, { area: 'in', via: 'gps' }) && !POSITION.test(r.whole),
      JSON.stringify(r.answers.where),
    );
  }

  // Default: a ZIP typed instead is checked against the published address list, then dropped.
  {
    await submit(F.verdict, '10.68.2.1', { where: { zip: '90210', area: 'in' } });
    const out = await latest(F.verdict);
    await submit(F.verdict, '10.68.2.2', { where: { zip: '93105-1234' } });
    const inside = await latest(F.verdict);
    check(
      'default: a typed ZIP gives { area, via: zip } and the ZIP is not stored',
      same(out.answers.where, { area: 'out', via: 'zip' }) &&
        same(inside.answers.where, { area: 'in', via: 'zip' }) &&
        !POSITION.test(out.whole) &&
        !POSITION.test(inside.whole),
      JSON.stringify([out.answers.where, inside.answers.where]),
    );
  }

  // Default: a typed place can't be checked; only that one was typed is kept.
  {
    await submit(F.verdict, '10.68.3.1', { where: { typed: 'Goleta, near the pier' } });
    const r = await latest(F.verdict);
    check(
      'default: a typed place is stored { via: typed }, the text dropped',
      same(r.answers.where, { via: 'typed' }) && !POSITION.test(r.whole),
      JSON.stringify(r.answers.where),
    );
  }

  // Default: a location with no area to check keeps only how it was given.
  {
    await submit(F.verdict, '10.68.3.2', { plain: { lat: 34.44, lng: -119.81 } });
    const r = await latest(F.verdict);
    check(
      'default, no service area: { via: gps } and no coordinates',
      same(r.answers.plain, { via: 'gps' }) && !POSITION.test(r.whole),
      JSON.stringify(r.answers.plain),
    );
  }

  // A verdict sent without the position it came from is never trusted.
  {
    const s = await submit(F.verdict, '10.68.4.1', {
      where: { area: 'in', via: 'gps' },
      plain: { area: 'in' },
    });
    const r = await latest(F.verdict);
    check(
      'a bare verdict with no position is dropped (the rest of the response is kept)',
      s.status === 200 && same(r.answers, {}),
      JSON.stringify(r.answers),
    );
  }

  // keepLocation: true stores what ADR-065 stored.
  {
    await submit(F.kept, '10.68.5.1', {
      where: { lat: 34.052235, lng: -118.243683, area: 'in' },
      plain: { lat: '34.441234', lng: '-119.812345' },
    });
    const a = (await latest(F.kept)).answers;
    check(
      'keepLocation: rounded coordinates kept, the forged "in" still corrected',
      same(a.where, { lat: '34.052', lng: '-118.244', area: 'out' }) &&
        same(a.plain, { lat: '34.441', lng: '-119.812' }),
      JSON.stringify(a),
    );
    await submit(F.kept, '10.68.5.2', { where: { zip: '93105-1234' } });
    const z = (await latest(F.kept)).answers.where;
    await submit(F.kept, '10.68.5.3', { where: { typed: ' Goleta ' } });
    const t = (await latest(F.kept)).answers.where;
    check(
      'keepLocation: a typed ZIP and a typed place are kept as before',
      same(z, { zip: '931051234', area: 'in' }) && same(t, { typed: 'Goleta' }),
      JSON.stringify([z, t]),
    );
  }

  // A form published before the option (ADR-065's shape) is verdict-only.
  {
    await submit(F.legacy, '10.68.6.1', {
      where: { lat: 34.052235, lng: -118.243683, area: 'in' },
    });
    const r = await latest(F.legacy);
    check(
      'a schema without keepLocation (published under ADR-065) is verdict-only',
      same(r.answers.where, { area: 'out', via: 'gps' }) && !POSITION.test(r.whole),
      JSON.stringify(r.answers.where),
    );
  }

  // Only a real `true` keeps it.
  {
    await submit(F.odd, '10.68.6.2', { where: { lat: 34.44, lng: -119.81 } });
    const r = await latest(F.odd);
    check(
      'keepLocation: "true" (a string) is verdict-only',
      same(r.answers.where, { area: 'in', via: 'gps' }) && !POSITION.test(r.whole),
      JSON.stringify(r.answers.where),
    );
  }

  // The page learns the option from the published schema (so it shows the right line).
  {
    const lookup = async (slug: string, ip: string) => {
      const res = await app.request(`/?op=form&slug=${slug}`, {
        method: 'GET',
        headers: { 'X-Forwarded-For': ip },
      });
      const b = (await res.json()) as {
        schema?: { questions?: Array<Record<string, unknown>> };
      };
      return b.schema?.questions?.find((x) => x.id === 'where');
    };
    const kept = await lookup(SLUG.kept, '10.68.7.1');
    const verdict = await lookup(SLUG.verdict, '10.68.7.2');
    check(
      'op=form serves keepLocation as published (true / absent)',
      kept?.keepLocation === true && verdict !== undefined && !('keepLocation' in verdict),
    );
  }

  // The owner reads the verdict back through RLS.
  {
    const r = await asOwner(
      `select answers->'where' as w from public.submissions
        where form_id = $1 order by received_at asc limit 1`,
      [F.verdict],
    );
    check(
      'the owner reads the stored verdict through the Data API role (RLS)',
      same((r.rows[0] as { w?: unknown })?.w, { area: 'out', via: 'gps' }),
    );
  }

  // Nothing on the branch holds a position for the verdict-only forms.
  {
    const [n] = await q<{ n: number }>(
      `select count(*)::int as n from public.submissions s, jsonb_each(s.answers) e
        where s.form_id = any($1) and jsonb_typeof(e.value) = 'object'
          and (e.value ? 'lat' or e.value ? 'lng' or e.value ? 'zip' or e.value ? 'typed')`,
      [[F.verdict, F.legacy, F.odd]],
    );
    check('no stored answer on a verdict-only form has lat / lng / zip / typed', n!.n === 0);
  }
}

async function latency() {
  const time = async (formId: string, prefix: string, answers: Record<string, unknown>) => {
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const res = await submit(formId, `${prefix}.${i + 1}`, answers);
      if (res.status !== 200) throw new Error(`latency submit ${res.status}`);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return { p50: ms[10]!, p95: ms[18]! };
  };
  const where = { lat: 34.44, lng: -119.81 };
  const v = await time(F.verdict, '10.68.8', { where });
  const k = await time(F.kept, '10.68.9', { where });
  console.log('\nSUBMIT LATENCY (ms, laptop → branch, real app in-process, 20 each)');
  console.log(`  verdict only   p50 ${v.p50.toFixed(1)}  p95 ${v.p95.toFixed(1)}`);
  console.log(`  kept location  p50 ${k.p50.toFixed(1)}  p95 ${k.p95.toFixed(1)}`);
}

async function main(): Promise<number> {
  const url = createBranch();
  db = new pg.Pool({ connectionString: url, max: 4 });
  try {
    // Wait for the branch's compute to answer.
    for (let i = 0; ; i++) {
      try {
        await q('select 1');
        break;
      } catch (err) {
        if (i >= 20) throw err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const [fn] = await q<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
    );
    if (!fn!.n) throw new Error('insert_public_submission (019) is missing on the branch');
    await seed();
    process.env.DATABASE_URL = url;
    app = (await import(resolve('neon/functions/submit-response/index.ts'))).default as App;
    await scenarios();
    await latency();
  } finally {
    await db.end().catch(() => {});
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  return failed.length ? 1 : 0;
}

main()
  .then((code) => {
    deleteBranch();
    process.exit(code);
  })
  .catch((err: unknown) => {
    // Messages only: an error from pg or neonctl must not dump a connection string.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[harness] failed:', msg.replace(/postgres(?:ql)?:\/\/\S+/g, '<redacted>'));
    deleteBranch();
    process.exit(1);
  });
