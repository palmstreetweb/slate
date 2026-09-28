/**
 * Branch harness for ADR-061 (slug-oracle): applies 017 to a THROWAWAY Neon branch, runs the REAL
 * submitresponse Hono app in-process against it, and prints a pass/fail line per scenario plus
 * p50/p95 latency for today's lookup (get_form_by_slug as the Data API's `anonymous` role) and the
 * new one (GET ?op=form). Applies 018 last, checks the old RPC is closed, then rolls 018 back.
 * Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch pooled neondb_owner> npx vite-node scripts/check-slug-oracle.ts
 *
 * DATABASE_URL must never be production: the host must not contain PROD_ENDPOINT (default
 * ep-misty-snow). Seeds owners u_s8b_* and forms f_s8b*, and each scenario uses its own
 * X-Forwarded-For range.
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
const db = new pg.Pool({ connectionString: DB_URL, max: 4 });
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

const OWNER = 'u_s8b_owner';
const F = {
  open: 'f_s8bopen00001',
  other: 'f_s8bopen00002',
  locked: 'f_s8block00001',
  draft: 'f_s8bdraft0001',
  trashed: 'f_s8btrash0001',
};
const SLUG: Record<keyof typeof F, string> = {
  open: '',
  other: '',
  locked: '',
  draft: '',
  trashed: '',
};
const PASSWORD = 'crowd-pass-1';
const schema = { brand: { name: 'Harness brand' }, questions: [{ id: 'q', type: 'short_text' }] };

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
    return r.rows as Record<string, unknown>[];
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

async function applyFile(name: string) {
  await db.query(readFileSync(resolve('neon/migrations', name), 'utf8'));
}

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  await q(`delete from public.forms where id like 'f_s8b%'`);
  for (const [k, id] of Object.entries(F) as Array<[keyof typeof F, string]>) {
    SLUG[k] = slug8();
    const status = k === 'draft' ? 'draft' : 'published';
    await asRole(
      'authenticated',
      OWNER,
      `insert into public.forms (id, name, slug, schema, published_schema, status, deleted_at)
       values ($1, $2, $3, $4::jsonb, case when $5 then null else $4::jsonb end, $6, $7)`,
      [
        id,
        `Harness ${k}`,
        SLUG[k],
        JSON.stringify(schema),
        k === 'draft',
        status,
        k === 'trashed' ? new Date().toISOString() : null,
      ],
    );
  }
  await q(
    `update public.forms set fill_password_hash = crypt($2, gen_salt('bf', 8)) where id = $1`,
    [F.locked, PASSWORD],
  );
}

/* ---------- reporting ---------- */

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

let app: App;
const get = (slug: string, ip: string | null) =>
  app.request(`/?op=form&slug=${encodeURIComponent(slug)}`, {
    method: 'GET',
    headers: ip ? { 'X-Forwarded-For': ip } : {},
  });
const unlock = (slug: string, ip: string, proof: Record<string, string>) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ op: 'unlock', slug, ...proof }),
  });

async function statuses(n: number, fn: (i: number) => Response | Promise<Response>, conc = 8) {
  const out: number[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, n) }, async () => {
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

async function missRow(ip: string) {
  const [r] = await q<{ n: number }>(
    `select coalesce(cardinality(misses), 0)::int as n from public.slug_miss_buckets where ip_key = $1`,
    [ip],
  );
  return r?.n ?? 0;
}
async function missStats() {
  await q('select pg_stat_clear_snapshot()');
  const [r] = await q<{ ins: string; upd: string; del: string }>(
    `select n_tup_ins::text as ins, n_tup_upd::text as upd, n_tup_del::text as del
       from pg_stat_user_tables where relname = 'slug_miss_buckets'`,
  );
  return `${r!.ins}/${r!.upd}/${r!.del}`;
}
// Idle backends flush their table stats up to 10 s late (PGSTAT_IDLE_INTERVAL).
const settle = () => new Promise((r) => setTimeout(r, 11_000));

/* ---------- scenarios ---------- */

async function scenarios() {
  // Published title.
  {
    const [row] = await q<{ published_name: string }>(
      'select published_name from public.forms where id = $1',
      [F.locked],
    );
    await asRole(
      'authenticated',
      OWNER,
      // What a studio save sends: the same published_schema and status, a new name, and a forged
      // published_name that the trigger must ignore.
      `update public.forms set name = 'LIVE SECRET RENAME', published_name = 'forged',
              published_schema = published_schema, status = 'published' where id = $1`,
      [F.locked],
    );
    const res = await get(SLUG.locked, '10.20.0.1');
    const body = (await res.json()) as Record<string, unknown>;
    const pw = await unlock(SLUG.locked, '10.20.0.1', { password: PASSWORD });
    const pwBody = (await pw.json()) as Record<string, unknown>;
    check(
      'locked: GET and unlock return the PUBLISHED title after a live rename; forged published_name ignored',
      row?.published_name === 'Harness locked' &&
        res.status === 200 &&
        body.name === 'Harness locked' &&
        body.locked === true &&
        body.schema === null &&
        !('fill_password_hash' in body) &&
        !('owner_id' in body) &&
        pw.status === 200 &&
        pwBody.name === 'Harness locked',
      `trigger=${row?.published_name} get=${res.status}/${String(body.name)} unlock=${pw.status}/${String(pwBody.name)}`,
    );
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set published_schema = schema || '{"v":2}'::jsonb where id = $1`,
      [F.locked],
    );
    const after = (await (await get(SLUG.locked, '10.20.0.1')).json()) as { name?: string };
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set name = 'Renamed open', status = 'draft' where id = $1`,
      [F.open],
    );
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set status = 'published' where id = $1`,
      [F.open],
    );
    const reopened = (await (await get(SLUG.open, '10.20.0.1')).json()) as { name?: string };
    check(
      'republish snapshots the new name (schema change, or unpublish → publish)',
      after.name === 'LIVE SECRET RENAME' && reopened.name === 'Renamed open',
      `locked=${String(after.name)} open=${String(reopened.name)}`,
    );

    // Rename with a customized brand (schema unchanged). The studio's save re-sends the old title;
    // its Republish sends published_name = name (ADR-061 addendum).
    const title = async () =>
      (
        await q<{ published_name: string }>(
          'select published_name from public.forms where id = $1',
          [F.other],
        )
      )[0]?.published_name;
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set name = 'Other renamed', published_name = 'Harness other',
              published_schema = published_schema, status = 'published' where id = $1`,
      [F.other],
    );
    const afterSave = await title();
    const savedGet = (await (await get(SLUG.other, '10.20.0.1')).json()) as { name?: string };
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set published_name = 'Other renamed',
              published_schema = published_schema, status = 'published' where id = $1`,
      [F.other],
    );
    const afterRepublish = await title();
    const republishedGet = (await (await get(SLUG.other, '10.20.0.1')).json()) as {
      name?: string;
    };
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set status = 'draft', name = 'Draft rename', published_name = 'Draft rename'
        where id = $1`,
      [F.other],
    );
    const draftTitle = await title();
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set name = 'Harness other', status = 'published' where id = $1`,
      [F.other],
    );
    check(
      'rename-only Republish: a save keeps the old title, published_name = name moves it, nothing else does',
      afterSave === 'Harness other' &&
        savedGet.name === 'Harness other' &&
        afterRepublish === 'Other renamed' &&
        republishedGet.name === 'Other renamed' &&
        draftTitle === 'Other renamed' &&
        (await title()) === 'Harness other',
      `save=${afterSave}/${String(savedGet.name)} republish=${afterRepublish}/${String(republishedGet.name)} draft=${draftTitle} restored=${await title()}`,
    );
  }

  // Scanner.
  {
    const ip = '10.21.0.1';
    const scan = await statuses(1000, () => get(slug8(), ip), 8);
    const hit = await get(SLUG.open, ip);
    const hitBody = (await hit.json()) as { error?: string; retryAfterSeconds?: number };
    // In-flight pre-checks near the edge may each answer one more 404; the stored set is exactly 300.
    const n404 = count(scan, 404);
    check(
      'scanner: 1,000 random slugs from one IP → ~300 × 404 then 429; a real slug is 429 too',
      n404 >= 300 &&
        n404 <= 308 &&
        count(scan, 429) === 1000 - n404 &&
        hit.status === 429 &&
        (await missRow(ip)) === 300,
      `404=${count(scan, 404)} 429=${count(scan, 429)} realSlug=${hit.status} retryAfter=${hitBody.retryAfterSeconds} misses=${await missRow(ip)}`,
    );
    check(
      '429 copy is friendly and names the wait',
      typeof hitBody.error === 'string' &&
        /^Too many .* about \d+ minutes?\. .*mobile data\.$/.test(hitBody.error) &&
        hit.headers.get('Retry-After') === String(hitBody.retryAfterSeconds),
      hitBody.error,
    );
    await settle();
    const before = await missStats();
    const denied = await statuses(300, (i) => get(i % 2 ? slug8() : SLUG.open, ip), 8);
    await settle();
    const after = await missStats();
    check(
      'denials write nothing (300 more, hits and misses: slug_miss_buckets ins/upd/del unchanged)',
      count(denied, 429) === 300 && before === after,
      `429=${count(denied, 429)} stats ${before} → ${after}`,
    );
    const other = await get(SLUG.open, '10.21.0.2');
    check('another network is unaffected', other.status === 200, `status=${other.status}`);
  }

  // Venue.
  {
    const ip = '10.22.0.1';
    const real = [SLUG.open, SLUG.other, SLUG.locked];
    const typos = Array.from({ length: 30 }, () => slug8());
    const plan = [
      ...Array.from({ length: 300 }, (_, i) => real[i % 3]!),
      ...typos,
      ...Array.from({ length: 300 }, () => SLUG.draft), // a dead QR: one slug, 300 scans
    ].sort(() => Math.random() - 0.5);
    const out = await statuses(plan.length, (i) => get(plan[i]!, ip), 8);
    const opens = out.filter((_, i) => real.includes(plan[i]!));
    check(
      'venue: 300 real opens + 30 typos + 300 scans of one dead slug → every open 200, no 429',
      count(opens, 200) === 300 && count(out, 429) === 0,
      `opens200=${count(opens, 200)} 404=${count(out, 404)} 429=${count(out, 429)} distinctMisses=${await missRow(ip)}`,
    );
  }

  // Hits cost nothing.
  {
    await settle();
    const before = await missStats();
    const hits = await statuses(200, (i) => get(SLUG.open, `10.23.${i >> 8}.${i & 255}`), 8);
    await settle();
    const after = await missStats();
    check(
      'hits write nothing (200 hits from 200 IPs: slug_miss_buckets unchanged)',
      count(hits, 200) === 200 &&
        before === after &&
        (
          await q<{ n: number }>(
            `select count(*)::int as n from public.slug_miss_buckets where ip_key like '10.23.%'`,
          )
        )[0]!.n === 0,
      `stats ${before} → ${after}`,
    );
  }

  // Draft and trashed read exactly like unknown.
  {
    const ip = '10.24.0.1';
    const s = [await get(SLUG.draft, ip), await get(SLUG.trashed, ip), await get('99999999', ip)];
    const bodies = await Promise.all(s.map((r) => r.text()));
    check(
      'draft, trashed and unknown slugs: identical 404 bodies',
      s.every((r) => r.status === 404) && new Set(bodies).size === 1,
      bodies[0],
    );
  }

  // Unlock shares the budget.
  {
    const ip = '10.25.0.1';
    const out = await statuses(400, () => unlock(slug8(), ip, { password: 'guess1' }), 8);
    const real = await unlock(SLUG.open, ip, { password: 'x' });
    const n401 = count(out, 401);
    check(
      'unlock scanner: 400 unknown slugs → ~300 × 401 then 429; an open form via unlock is 429 too',
      n401 >= 300 &&
        n401 <= 308 &&
        count(out, 429) === 400 - n401 &&
        real.status === 429 &&
        (await missRow(ip)) === 300,
      `401=${count(out, 401)} 429=${count(out, 429)} open=${real.status}`,
    );
  }

  // Races: 400 distinct misses from one IP on 32 connections at once never push past the budget.
  {
    const ip = '10.26.0.1';
    const wide = new pg.Pool({ connectionString: DB_URL, max: 32 });
    const outcomes: string[] = [];
    let errors = 0;
    await Promise.all(
      Array.from({ length: 400 }, async () => {
        try {
          const r = await wide.query<{ outcome: string }>(
            'select outcome from public.lookup_public_form($1, $2, 300, 600)',
            [slug8(), ip],
          );
          outcomes.push(r.rows[0]!.outcome);
        } catch {
          errors += 1;
        }
      }),
    );
    await wide.end();
    const n = await missRow(ip);
    const c = (o: string) => outcomes.filter((x) => x === o).length;
    check(
      'race: 400 distinct misses on 32 connections → stored misses exactly 300, no errors',
      n === 300 && errors === 0 && c('miss') + c('denied') === 400,
      `misses=${n} miss=${c('miss')} denied=${c('denied')} errors=${errors}`,
    );
  }

  // No X-Forwarded-For.
  {
    const out = await statuses(31, () => get(slug8(), null), 1);
    check(
      'no X-Forwarded-For: the shared noip key at 30 misses',
      count(out, 404) === 30 && out[30] === 429,
      `404=${count(out, 404)} last=${out[30]}`,
    );
  }

  // Old bundles: the Data API role still reads the RPC during the overlap, with the published title.
  {
    const rows = await asRole('anonymous', null, 'select * from public.get_form_by_slug($1)', [
      SLUG.locked,
    ]);
    const openRows = await asRole('anonymous', null, 'select * from public.get_form_by_slug($1)', [
      SLUG.open,
    ]);
    check(
      'overlap: anonymous get_form_by_slug still works; locked row carries the published title, no schema',
      rows.length === 1 &&
        rows[0]!.name === 'LIVE SECRET RENAME' && // republished above, so this IS the published title
        rows[0]!.locked === true &&
        rows[0]!.schema === null &&
        openRows.length === 1 &&
        openRows[0]!.schema !== null,
      JSON.stringify(rows[0] ?? null).slice(0, 120),
    );
    await asRole(
      'authenticated',
      OWNER,
      `update public.forms set name = 'Second live rename' where id = $1`,
      [F.locked],
    );
    const still = await asRole('anonymous', null, 'select name from public.get_form_by_slug($1)', [
      SLUG.locked,
    ]);
    check(
      'overlap: a rename without republishing never reaches the old RPC',
      still[0]?.name === 'LIVE SECRET RENAME',
      String(still[0]?.name),
    );
  }

  // 018, then its rollback.
  {
    await applyFile('018_revoke_get_form_by_slug.sql');
    const denied = async (role: 'anonymous' | 'authenticated') => {
      try {
        await asRole(
          role,
          role === 'authenticated' ? OWNER : null,
          'select * from public.get_form_by_slug($1)',
          [SLUG.open],
        );
        return 'allowed';
      } catch (err) {
        return (err as { code?: string }).code ?? 'error';
      }
    };
    const anon = await denied('anonymous');
    const auth = await denied('authenticated');
    const fn = await get(SLUG.open, '10.27.0.1');
    await q('grant execute on function public.get_form_by_slug(text) to anonymous, authenticated');
    const back = await denied('anonymous');
    check(
      '018: anonymous and authenticated get 42501; the Function path still 200; rollback GRANT restores it',
      anon === '42501' && auth === '42501' && fn.status === 200 && back === 'allowed',
      `anon=${anon} auth=${auth} fn=${fn.status} afterRollback=${back}`,
    );
    await applyFile('018_revoke_get_form_by_slug.sql');
  }
}

/* ---------- latency ---------- */

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
async function timed(n: number, fn: (i: number) => Promise<unknown>) {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn(i);
    ms.push(performance.now() - t0);
  }
  return { p50: pct(ms, 50), p95: pct(ms, 95) };
}

async function latency() {
  await q(`grant execute on function public.get_form_by_slug(text) to anonymous, authenticated`);
  // Warm the pools and the compute.
  for (let i = 0; i < 5; i++) {
    await (await get(SLUG.open, '10.29.9.9')).arrayBuffer();
    await asRole('anonymous', null, 'select * from public.get_form_by_slug($1)', [SLUG.open]);
  }
  const rows: Array<[string, { p50: number; p95: number }]> = [];
  rows.push([
    'today: get_form_by_slug, raw statement',
    await timed(200, () => q('select * from public.get_form_by_slug($1)', [SLUG.open])),
  ]);
  rows.push([
    'new: lookup_public_form hit, raw statement',
    await timed(200, (i) =>
      q('select * from public.lookup_public_form($1, $2, 300, 600)', [
        SLUG.open,
        `10.30.${i >> 8}.${i & 255}`,
      ]),
    ),
  ]);
  const via = async (slug: string, ip: string) => (await get(slug, ip)).arrayBuffer();
  rows.push([
    'new: GET ?op=form hit (in-process app)',
    await timed(200, (i) => via(SLUG.open, `10.31.${i >> 8}.${i & 255}`)),
  ]);
  rows.push([
    'new: GET ?op=form miss',
    await timed(200, (i) => via(slug8(), `10.32.${i >> 8}.${i & 255}`)),
  ]);
  rows.push(['new: GET ?op=form denied', await timed(200, () => via(SLUG.open, '10.21.0.1'))]);
  // Server-side cost per call, no network: 1,000 calls inside one DO block each.
  const perCall = async (label: string, body: string) => {
    const c = await db.connect();
    let note = '';
    c.on('notice', (m) => (note = m.message ?? ''));
    try {
      await c.query(`do $$ declare t0 timestamptz; i int; begin
        t0 := clock_timestamp();
        for i in 1..1000 loop ${body} end loop;
        raise notice '%', round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
      end $$;`);
    } finally {
      c.release();
    }
    serverSide.push([label, Number(note) / 1000]);
  };
  const serverSide: Array<[string, number]> = [];
  await perCall(
    'today: get_form_by_slug hit',
    `perform * from public.get_form_by_slug('${SLUG.open}');`,
  );
  await perCall(
    'new: lookup_public_form hit',
    `perform * from public.lookup_public_form('${SLUG.open}', '10.33.0.' || (i % 250), 300, 600);`,
  );
  await perCall(
    'new: lookup_public_form miss (new IP each call)',
    `perform * from public.lookup_public_form((20000000 + i)::text, '10.34.' || (i / 250) || '.' || (i % 250), 300, 600);`,
  );
  await perCall(
    'new: lookup_public_form denied',
    `perform * from public.lookup_public_form('${SLUG.open}', '10.21.0.1', 300, 600);`,
  );
  console.log('\nSERVER-SIDE (ms per call, 1,000 calls in one DO block)');
  for (const [name, ms] of serverSide) console.log(`  ${name.padEnd(58)} ${ms.toFixed(3)}`);

  console.log('\nLATENCY (ms, laptop → branch; network legs in ADR-061)');
  for (const [name, r] of rows) {
    console.log(
      `  ${name.padEnd(58)} p50 ${r.p50.toFixed(1).padStart(6)}  p95 ${r.p95.toFixed(1).padStart(6)}`,
    );
  }
  await applyFile('018_revoke_get_form_by_slug.sql');
  return rows;
}

async function main() {
  console.log('[harness] applying 017 twice (idempotent)');
  await applyFile('017_slug_oracle.sql');
  await applyFile('017_slug_oracle.sql');
  const [nulls] = await q<{ n: number }>(
    `select count(*)::int as n from public.forms where published_schema is not null and published_name is null`,
  );
  check(
    '017 backfill: every published row has a published_name',
    nulls!.n === 0,
    `nulls=${nulls!.n}`,
  );
  await seed();
  process.env.DATABASE_URL = DB_URL;
  app = (await import(resolve('neon/functions/submit-response/index.ts'))).default as App;
  await scenarios();
  const table = await latency();
  await q(`delete from public.slug_miss_buckets where ip_key like '10.%' or ip_key = 'noip'`);
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.2%'`);
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
