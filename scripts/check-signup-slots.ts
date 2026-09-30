/**
 * Branch harness for ADR-066 (sign-up slots): applies migration 020 to a THROWAWAY Neon branch
 * (019 is already on production), runs the REAL submitresponse Hono app in-process against it, and
 * prints a pass/fail line per scenario, then crowd timings. Tries 020's rollback block (the Wave C
 * Function's insert still works) and re-applies 020. Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-signup-slots.ts
 *
 * DATABASE_URL must never be production: the host must not contain PROD_ENDPOINT (default
 * ep-misty-snow). Seeds owners u_s66_* and forms f_s66*; every scenario uses its own
 * X-Forwarded-For range. Cleans up after itself (the branch is deleted afterwards anyway).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { signupSlotsOf } from '../src/logic/signup.js';

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

const OWNER = 'u_s66_owner';
const STRANGER = 'u_s66_stranger';
const F = {
  swim: 'f_s66swim00001',
  locked: 'f_s66lock00001',
  plain: 'f_s66plain0001',
  capped: 'f_s66capd00001',
  crowd: 'f_s66crowd0001',
  big: 'f_s66bigcrowd1',
};
const SLUG: Record<keyof typeof F, string> = {
  swim: '',
  locked: '',
  plain: '',
  capped: '',
  crowd: '',
  big: '',
};

const swimSchema = {
  brand: { name: 'Harness pool' },
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    {
      id: 'swim',
      type: 'signup_slots',
      title: 'Pick a time',
      waitlist: true,
      maxPicks: 2,
      slots: [
        {
          label: 'Sat 10–11am',
          value: 'sat10',
          capacity: 8,
          date: '2026-10-03',
          start: '10:00',
          end: '11:00',
        },
        { label: 'Sat 11–12', value: 'sat11', capacity: 2 },
        { label: 'Lunch swim', value: 'sat12', capacity: 1 },
      ],
    },
    {
      id: 'bring',
      type: 'signup_slots',
      title: 'Bring',
      slots: [{ label: 'Drinks', value: 'drinks', capacity: 3 }],
    },
  ],
};
const oneSlot = (cap: number) => ({
  brand: { name: 'Harness crowd' },
  questions: [
    {
      id: 'shift',
      type: 'signup_slots',
      title: 'Shift',
      slots: [{ label: 'Only shift', value: 'only', capacity: cap }],
    },
  ],
});
const bigSchema = {
  brand: { name: 'Harness big crowd' },
  questions: [
    {
      id: 'tour',
      type: 'signup_slots',
      title: 'Open house tour',
      slots: ['t1', 't2', 't3', 't4', 't5'].map((v, i) => ({
        label: `Tour ${i + 1}`,
        value: v,
        capacity: 20,
      })),
    },
  ],
};
const plainSchema = {
  brand: { name: 'Harness plain' },
  questions: [{ id: 'name', type: 'short_text', title: 'Name' }],
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
  const text = readFileSync(resolve('neon/migrations/020_signup_slots.sql'), 'utf8');
  const block = text.slice(text.indexOf('-- Rollback'));
  return block
    .split('\n')
    .filter((l) => l.startsWith('--   '))
    .map((l) => l.slice(5))
    .filter((l) => !l.startsWith('then:'))
    .join('\n');
}

async function cleanup() {
  await q(`delete from public.submissions where form_id like 'f_s66%'`);
  await q(`delete from public.forms where id like 'f_s66%'`);
  await q(`delete from public.retired_slugs where owner_id like 'u_s66%'`).catch(() => {});
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.66.%'`).catch(
    () => {},
  );
  await q(`delete from public.slug_miss_buckets where ip_key like '10.66.%'`).catch(() => {});
}

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  await cleanup();
  const forms: Array<[keyof typeof F, unknown, Record<string, unknown>]> = [
    ['swim', swimSchema, {}],
    ['locked', swimSchema, {}],
    ['plain', plainSchema, {}],
    ['capped', oneSlot(5), { max_responses: 3 }],
    ['crowd', oneSlot(8), {}],
    ['big', bigSchema, {}],
  ];
  for (const [k, schema, extra] of forms) {
    SLUG[k] = slug8();
    // Through the Data API role, as the studio writes it (RLS, triggers).
    await asOwner(
      `insert into public.forms (id, name, slug, schema, published_schema, status${
        extra.max_responses ? ', max_responses' : ''
      })
       values ($1, $2, $3, $4::jsonb, $4::jsonb, 'published'${extra.max_responses ? ', $5' : ''})`,
      [
        F[k],
        `Harness ${k}`,
        SLUG[k],
        JSON.stringify(schema),
        ...(extra.max_responses ? [extra.max_responses] : []),
      ],
    );
  }
  await asOwner(`select public.set_form_fill_password($1, $2)`, [F.locked, 'harness-66']);
}

const asOwner = (sql: string, params: unknown[]) => asRole('authenticated', OWNER, sql, params);

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

let apps: App[] = [];
const app = () => apps[0]!;
const meta = () => ({
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 60_000,
  questionsVisited: [],
  hiddenFields: {},
  score: 0,
});
const submitVia = (
  a: App,
  formId: string,
  ip: string,
  answers: Record<string, unknown>,
  unlockToken?: string,
) =>
  a.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({
      formId,
      answers,
      meta: meta(),
      ...(unlockToken ? { unlockToken } : {}),
    }),
  });
const submit = (formId: string, ip: string, answers: Record<string, unknown>, token?: string) =>
  submitVia(app(), formId, ip, answers, token);
const lookup = (slug: string, ip: string, part = '') =>
  app().request(`/?op=form&slug=${slug}${part ? `&part=${part}` : ''}`, {
    method: 'GET',
    headers: { 'X-Forwarded-For': ip },
  });
const body = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;

const claims = async (formId: string, question?: string, slot?: string) =>
  (
    await q<{ n: number }>(
      `select count(*)::int as n from public.signup_claims
        where form_id = $1 and ($2::text is null or question_id = $2) and ($3::text is null or slot = $3)`,
      [formId, question ?? null, slot ?? null],
    )
  )[0]!.n;
const live = async (formId: string) =>
  (
    await q<{ n: number }>(
      `select count(*)::int as n from public.submissions where form_id = $1 and deleted_at is null`,
      [formId],
    )
  )[0]!.n;

/* ---------- parity: signup_slots_of (SQL) vs signupSlotsOf (engine) ---------- */

function tsDef(schema: unknown): Record<string, Record<string, number>> | null {
  const qs = (schema as { questions?: unknown } | null)?.questions;
  const out: Record<string, Record<string, number>> = {};
  // The last question with each id decides, as in the Function's map.
  for (const x of Array.isArray(qs) ? qs : []) {
    const r = x as Record<string, unknown>;
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string') continue;
    const caps =
      r.type === 'signup_slots'
        ? Object.fromEntries(signupSlotsOf(r).map((s) => [s.value, s.capacity]))
        : {};
    if (Object.keys(caps).length) out[r.id] = caps;
    else delete out[r.id];
  }
  return Object.keys(out).length ? out : null;
}

function randomSchema(seed: number): unknown {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const caps = [8, 1, 1000, 1001, 0, -3, 2.5, 8.0, '8', null, true, 1e3, 999.9999, 50];
  const values = [
    'a',
    'b',
    'c',
    'sat_10',
    'x-y',
    'bad value',
    '',
    'v'.repeat(64),
    'v'.repeat(65),
    7,
    'a',
  ];
  const questions = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => ({
    id: pick(['q1', 'q2', `q${i}`]),
    type: pick(['signup_slots', 'signup_slots', 'single_choice']),
    title: 'T',
    slots:
      rnd() < 0.1
        ? 'nope'
        : Array.from({ length: Math.floor(rnd() * 60) }, () =>
            rnd() < 0.05 ? 'junk' : { label: 'L', value: pick(values), capacity: pick(caps) },
          ),
  }));
  return { brand: { name: 'x' }, questions };
}

async function parity() {
  const fixed: unknown[] = [
    swimSchema,
    bigSchema,
    plainSchema,
    null,
    {},
    { questions: 'x' },
    { questions: [{ id: 'q', type: 'signup_slots' }] },
    {
      questions: [
        { id: 'q', type: 'signup_slots', slots: [{ value: 'a', capacity: 2 }] },
        { id: 'q', type: 'signup_slots', slots: [{ value: 'b', capacity: 3 }] },
      ],
    },
    {
      questions: [
        {
          id: 'q',
          type: 'signup_slots',
          slots: [
            { value: 'a', capacity: 'x' },
            { value: 'a', capacity: 4 },
            { value: 'a', capacity: 9 },
          ],
        },
      ],
    },
    {
      questions: [
        {
          id: 'q',
          type: 'signup_slots',
          slots: Array.from({ length: 60 }, (_, i) => ({ value: `s${i}`, capacity: 1 })),
        },
      ],
    },
  ];
  const all = [...fixed, ...Array.from({ length: 300 }, (_, i) => randomSchema(i + 1))];
  let bad = 0;
  let first = '';
  for (const schema of all) {
    const [row] = await q<{ def: unknown }>(`select public.signup_slots_of($1::jsonb) as def`, [
      schema === null ? null : JSON.stringify(schema),
    ]);
    const want = tsDef(schema);
    if (!same(row!.def ?? null, want)) {
      bad += 1;
      if (!first) first = JSON.stringify({ sql: row!.def, ts: want }).slice(0, 300);
    }
  }
  check(
    `signup_slots_of in SQL matches the engine's signupSlotsOf on ${all.length} schemas (fixed + random junk)`,
    bad === 0,
    bad ? `${bad} differ; first: ${first}` : '',
  );
}

/* ---------- scenarios ---------- */

async function scenarios() {
  // Triggers: the published slots are derived and pinned.
  {
    const [row] = await q<{ def: unknown }>(
      `select signup_slots as def from public.forms where id = $1`,
      [F.swim],
    );
    check(
      'forms.signup_slots is derived from the published schema on insert (Data API role)',
      same(row!.def, { swim: { sat10: 8, sat11: 2, sat12: 1 }, bring: { drinks: 3 } }),
      JSON.stringify(row!.def),
    );
    await asOwner(`update public.forms set signup_slots = '{"swim":{"sat12":999}}' where id = $1`, [
      F.swim,
    ]);
    const [after] = await q<{ def: unknown }>(
      `select signup_slots as def from public.forms where id = $1`,
      [F.swim],
    );
    check(
      'an owner cannot write signup_slots directly (pinned by the trigger)',
      same(after!.def, row!.def),
    );
    const [plain] = await q<{ def: unknown }>(
      `select signup_slots as def from public.forms where id = $1`,
      [F.plain],
    );
    check('a form without sign-up questions has no slots (null)', plain!.def === null);
  }

  // Lookup: counts only, never for a locked form before unlock.
  {
    const res = await lookup(SLUG.swim, '10.66.1.1');
    const b = await body(res);
    check(
      'op=form serves the schema with every slot’s spots left',
      res.status === 200 &&
        same(b.slotsLeft, { swim: { sat10: 8, sat11: 2, sat12: 1 }, bring: { drinks: 3 } }) &&
        !!b.schema,
      JSON.stringify(b.slotsLeft),
    );
    const part = await body(await lookup(SLUG.swim, '10.66.1.2', 'slots'));
    check(
      'op=form&part=slots sends the counts without the schema',
      !('schema' in part) && same(part.slotsLeft, b.slotsLeft) && part.id === F.swim,
    );
    const locked = await body(await lookup(SLUG.locked, '10.66.1.3'));
    const lockedPart = await body(await lookup(SLUG.locked, '10.66.1.4', 'slots'));
    check(
      'a locked form’s lookup carries no counts (before or with part=slots)',
      locked.locked === true && !('slotsLeft' in locked) && !('slotsLeft' in lockedPart),
    );
    const plain = await body(await lookup(SLUG.plain, '10.66.1.5'));
    check('a form without slots has no slotsLeft', !('slotsLeft' in plain));
    const text = JSON.stringify(b);
    check(
      'counts never reveal who signed up (no names, ids or claims in the lookup)',
      !/claim|submission|s_[0-9a-f]{12}/.test(text.replace(F.swim, '')),
    );
  }

  // Taking spots, exact at capacity, 409 naming the slot, nothing stored.
  {
    const ok1 = await submit(F.swim, '10.66.2.1', { name: 'Ada', swim: { slots: ['sat12'] } });
    const claimed = await claims(F.swim, 'swim', 'sat12');
    const full = await submit(F.swim, '10.66.2.2', { name: 'Grace', swim: { slots: ['sat12'] } });
    const fb = await body(full);
    check(
      'a submit takes the spot; the next one for a full slot is 409 slot_full naming it',
      ok1.status === 200 &&
        claimed === 1 &&
        full.status === 409 &&
        fb.reason === 'slot_full' &&
        same(fb.full, [{ question: 'swim', slot: 'sat12', label: 'Lunch swim' }]) &&
        (fb.slotsLeft as Record<string, Record<string, number>>)?.swim?.sat12 === 0 &&
        typeof fb.error === 'string' &&
        (fb.error as string).includes('Lunch swim'),
      `${ok1.status}/${full.status} ${JSON.stringify(fb.full)}`,
    );
    check('the refused response stored nothing', (await live(F.swim)) === 1);
    const multi = await submit(F.swim, '10.66.2.3', {
      name: 'Alan',
      swim: { slots: ['sat10', 'sat12'] },
    });
    const mb = await body(multi);
    check(
      'two picks where one is full: 409 names only the full one, the other spot is not taken',
      multi.status === 409 &&
        same(mb.full, [{ question: 'swim', slot: 'sat12', label: 'Lunch swim' }]) &&
        (await claims(F.swim, 'swim', 'sat10')) === 0,
    );
    const two = await submit(F.swim, '10.66.2.4', {
      name: 'Kay',
      swim: { slots: ['sat10', 'sat11', 'sat12'], wait: ['sat12'] },
      bring: { slots: ['drinks'] },
    });
    const [kay] = await q<{ answers: Record<string, unknown> }>(
      `select answers from public.submissions where form_id = $1 and answers->>'name' = 'Kay'`,
      [F.swim],
    );
    check(
      'answers are clamped to the question: at most maxPicks, wait only for untaken slots',
      two.status === 200 &&
        same(kay?.answers.swim, { slots: ['sat10', 'sat11'] }) &&
        (await claims(F.swim, 'swim', 'sat10')) === 1 &&
        (await claims(F.swim, 'bring', 'drinks')) === 1,
      JSON.stringify(kay?.answers.swim),
    );
    const waiter = await submit(F.swim, '10.66.2.5', {
      name: 'Radia',
      swim: { slots: [], wait: ['sat12'] },
    });
    const [rw] = await q<{ answers: Record<string, unknown> }>(
      `select answers from public.submissions where form_id = $1 and answers->>'name' = 'Radia'`,
      [F.swim],
    );
    check(
      'joining a full slot’s waitlist is stored and takes no spot',
      waiter.status === 200 &&
        same(rw?.answers.swim, { slots: [], wait: ['sat12'] }) &&
        (await claims(F.swim, 'swim', 'sat12')) === 1,
    );
    const left = await body(await lookup(SLUG.swim, '10.66.2.6'));
    check(
      'the lookup now shows the spots taken',
      same(left.slotsLeft, { swim: { sat10: 7, sat11: 1, sat12: 0 }, bring: { drinks: 2 } }),
      JSON.stringify(left.slotsLeft),
    );
  }

  // Trash frees a spot, restore takes it back (even past capacity), permanent delete cascades.
  {
    const [ada] = await q<{ id: string }>(
      `select id from public.submissions where form_id = $1 and answers->>'name' = 'Ada'`,
      [F.swim],
    );
    await asOwner(`update public.submissions set deleted_at = now() where id = $1`, [ada!.id]);
    const freed = await claims(F.swim, 'swim', 'sat12');
    const again = await submit(F.swim, '10.66.3.1', { name: 'Grace', swim: { slots: ['sat12'] } });
    check(
      'trashing a response frees its spot; the next submit takes it',
      freed === 0 && again.status === 200 && (await claims(F.swim, 'swim', 'sat12')) === 1,
    );
    await asOwner(`update public.submissions set deleted_at = null where id = $1`, [ada!.id]);
    const over = await claims(F.swim, 'swim', 'sat12');
    const lk = await body(await lookup(SLUG.swim, '10.66.3.2'));
    check(
      'restoring takes the spot back even past capacity (owner action); the lookup says 0, never negative',
      over === 2 && (lk.slotsLeft as Record<string, Record<string, number>>)?.swim?.sat12 === 0,
    );
    await asOwner(`delete from public.submissions where id = $1`, [ada!.id]);
    check('a permanent delete removes its claims', (await claims(F.swim, 'swim', 'sat12')) === 1);
  }

  // The owner's roster move.
  {
    const [grace] = await q<{ id: string }>(
      `select id from public.submissions where form_id = $1 and answers->>'name' = 'Grace' and deleted_at is null`,
      [F.swim],
    );
    const [radia] = await q<{ id: string }>(
      `select id from public.submissions where form_id = $1 and answers->>'name' = 'Radia'`,
      [F.swim],
    );
    const mv = async (who: string, id: string, from: string, to: string, force = false) =>
      (
        await asRole(
          'authenticated',
          who,
          `select * from public.move_signup_slot($1, 'swim', $2, $3, $4)`,
          [id, from, to, force],
        )
      ).rows[0] as { outcome: string; taken: number | null; capacity: number | null };
    const moved = await mv(OWNER, grace!.id, 'sat12', 'sat10');
    const [ga] = await q<{ a: unknown }>(
      `select answers->'swim' as a from public.submissions where id = $1`,
      [grace!.id],
    );
    check(
      'the owner moves someone to a slot with room: answer and claims follow',
      moved.outcome === 'ok' &&
        same(ga!.a, { slots: ['sat10'] }) &&
        (await claims(F.swim, 'swim', 'sat12')) === 0 &&
        (await claims(F.swim, 'swim', 'sat10')) === 2,
      JSON.stringify(moved),
    );
    const promote = await mv(OWNER, radia!.id, 'sat12', 'sat12');
    const [ra] = await q<{ a: unknown }>(
      `select answers->'swim' as a from public.submissions where id = $1`,
      [radia!.id],
    );
    check(
      'a waitlisted person is given the spot that opened (from = to)',
      promote.outcome === 'ok' &&
        same(ra!.a, { slots: ['sat12'] }) &&
        (await claims(F.swim, 'swim', 'sat12')) === 1,
    );
    const refused = await mv(OWNER, grace!.id, 'sat10', 'sat12');
    const forced = await mv(OWNER, grace!.id, 'sat10', 'sat12', true);
    check(
      'moving into a full slot is refused (full, 1 of 1) unless forced',
      refused.outcome === 'full' &&
        refused.taken === 1 &&
        refused.capacity === 1 &&
        forced.outcome === 'ok' &&
        (await claims(F.swim, 'swim', 'sat12')) === 2,
    );
    const stranger = await mv(STRANGER, grace!.id, 'sat12', 'sat10');
    const anon = await sqlError(() =>
      asRole(
        'anonymous',
        null,
        `select * from public.move_signup_slot($1, 'swim', 'sat12', 'sat10')`,
        [grace!.id],
      ),
    );
    const badSlot = await mv(OWNER, grace!.id, 'sat12', 'nope');
    check(
      'another account gets not_found; anonymous may not call it; an unknown slot is bad_slot',
      stranger.outcome === 'not_found' && anon === '42501' && badSlot.outcome === 'bad_slot',
      `${stranger.outcome}/${anon}/${badSlot.outcome}`,
    );
  }

  // Grants: nothing but the owner-checked move for the Data API roles.
  {
    const codes: string[] = [];
    for (const role of ['anonymous', 'authenticated'] as const) {
      codes.push(
        (await sqlError(() =>
          asRole(
            role,
            role === 'authenticated' ? OWNER : null,
            `select count(*) from public.signup_claims`,
            [],
          ),
        )) ?? 'none',
        (await sqlError(() =>
          asRole(
            role,
            role === 'authenticated' ? OWNER : null,
            `select * from public.insert_public_submission('s_x', $1, '{}', '{}')`,
            [F.swim],
          ),
        )) ?? 'none',
        (await sqlError(() =>
          asRole(
            role,
            role === 'authenticated' ? OWNER : null,
            `select public.signup_left($1, '{}')`,
            [F.swim],
          ),
        )) ?? 'none',
      );
    }
    check(
      'anonymous and authenticated: 42501 on the claims table, the insert and signup_left',
      codes.every((c) => c === '42501'),
      codes.join(','),
    );
  }

  // Locked form: counts come with the unlock, and submits still count.
  {
    const res = await app().request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.66.5.1' },
      body: JSON.stringify({ op: 'unlock', slug: SLUG.locked, password: 'harness-66' }),
    });
    const b = await body(res);
    const token = b.unlockToken as string;
    const s = await submit(F.locked, '10.66.5.2', { swim: { slots: ['sat12'] } }, token);
    const reload = await body(
      await app().request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.66.5.3' },
        body: JSON.stringify({ op: 'unlock', slug: SLUG.locked, token }),
      }),
    );
    check(
      'a locked form: counts arrive with the unlock and refresh with the tab’s token',
      res.status === 200 &&
        same(b.slotsLeft, { swim: { sat10: 8, sat11: 2, sat12: 1 }, bring: { drinks: 3 } }) &&
        s.status === 200 &&
        (reload.slotsLeft as Record<string, Record<string, number>>)?.swim?.sat12 === 0,
    );
  }

  // A response cap and slots on one form: one lock, both exact.
  {
    const st: number[] = [];
    for (let i = 0; i < 5; i++) {
      st.push((await submit(F.capped, `10.66.6.${i + 1}`, { shift: { slots: ['only'] } })).status);
    }
    check(
      'a capped form with slots: the cap (3) closes it first (409 full), claims match the responses',
      same(st, [200, 200, 200, 409, 409]) && (await claims(F.capped)) === 3,
      st.join(','),
    );
  }

  // The owner's test run (Data API insert) and a republish that changes a capacity.
  {
    await asOwner(
      `insert into public.submissions (id, form_id, answers, meta) values ('s_s66testrun01', $1, $2::jsonb, '{}'::jsonb)`,
      [F.swim, JSON.stringify({ swim: { slots: ['sat11'] } })],
    );
    const viaDataApi = await claims(F.swim, 'swim', 'sat11');
    const next = JSON.parse(JSON.stringify(swimSchema)) as typeof swimSchema;
    (next.questions[1] as { slots: Array<{ capacity: number }> }).slots[1]!.capacity = 5;
    await asOwner(`update public.forms set published_schema = $2::jsonb where id = $1`, [
      F.swim,
      JSON.stringify(next),
    ]);
    const lk = await body(await lookup(SLUG.swim, '10.66.7.1'));
    check(
      'a studio test run (Data API insert) takes its spot; a republish changes capacity at once',
      viaDataApi === 2 &&
        (lk.slotsLeft as Record<string, Record<string, number>>)?.swim?.sat11 === 3,
      `${viaDataApi} / ${JSON.stringify(lk.slotsLeft)}`,
    );
  }
}

/* ---------- crowds ---------- */

function pct(ms: number[], p: number): number {
  const s = [...ms].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function crowds() {
  // 50 people, one slot of 8, at once, through the real app (10 isolates × a pool of 5).
  {
    const t0 = performance.now();
    const ms: number[] = [];
    const statuses = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const s0 = performance.now();
        const r = await submitVia(apps[i % apps.length]!, F.crowd, `10.66.8.${i + 1}`, {
          shift: { slots: ['only'] },
        });
        const b = await body(r);
        ms.push(performance.now() - s0);
        return r.status === 409 && b.reason === 'slot_full' ? 409 : r.status;
      }),
    );
    const wall = performance.now() - t0;
    const ok = statuses.filter((s) => s === 200).length;
    const full = statuses.filter((s) => s === 409).length;
    const stored = await live(F.crowd);
    const claimed = await claims(F.crowd);
    check(
      '50 simultaneous claims on a slot of 8 store exactly 8 (42 × 409 slot_full)',
      ok === 8 && full === 42 && stored === 8 && claimed === 8,
      `200×${ok} 409×${full} stored ${stored} claims ${claimed}`,
    );
    console.log(
      `  crowd of 50 via the app: wall ${wall.toFixed(0)} ms, per request p50 ${pct(ms, 50).toFixed(0)} p95 ${pct(ms, 95).toFixed(0)} max ${Math.max(...ms).toFixed(0)} ms`,
    );
  }

  // 300 people, five tours of 20, at once, through the real app.
  {
    const t0 = performance.now();
    const ms: number[] = [];
    const statuses = await Promise.all(
      Array.from({ length: 300 }, async (_, i) => {
        const s0 = performance.now();
        const r = await submitVia(
          apps[i % apps.length]!,
          F.big,
          `10.66.${9 + (i >> 8)}.${(i & 255) + 1}`,
          {
            tour: { slots: [`t${(i % 5) + 1}`] },
          },
        );
        await r.arrayBuffer().catch(() => {});
        ms.push(performance.now() - s0);
        return r.status;
      }),
    );
    const wall = performance.now() - t0;
    const per = await q<{ slot: string; n: number }>(
      `select slot, count(*)::int as n from public.signup_claims where form_id = $1 group by slot order by slot`,
      [F.big],
    );
    const ok = statuses.filter((s) => s === 200).length;
    check(
      '300 people grabbing 5 tours of 20 at once: exactly 20 each, 200 refused, no errors',
      ok === 100 &&
        statuses.filter((s) => s === 409).length === 200 &&
        per.length === 5 &&
        per.every((r) => r.n === 20) &&
        (await live(F.big)) === 100,
      `${JSON.stringify(per)} statuses ${[...new Set(statuses)].join(',')}`,
    );
    console.log(
      `  crowd of 300 via the app: wall ${wall.toFixed(0)} ms, per request p50 ${pct(ms, 50).toFixed(0)} p95 ${pct(ms, 95).toFixed(0)} max ${Math.max(...ms).toFixed(0)} ms`,
    );
  }

  // The same insert straight at Postgres from 40 connections: the lock alone. (The app pools'
  // idle connections close after 10 s first, to stay inside the branch's connection limit.)
  {
    await q(`delete from public.submissions where form_id = $1`, [F.big]);
    await new Promise((r) => setTimeout(r, 11_000));
    const direct = new pg.Pool({ connectionString: DB_URL, max: 40 });
    await Promise.all(Array.from({ length: 40 }, () => direct.query('select 1')));
    const t0 = performance.now();
    const ms: number[] = [];
    const out = await Promise.all(
      Array.from({ length: 300 }, async (_, i) => {
        const s0 = performance.now();
        const r = await direct.query(
          `select outcome from public.insert_public_submission($1, $2, $3::jsonb, '{}'::jsonb)`,
          [
            `s_s66d${String(i).padStart(7, '0')}`,
            F.big,
            JSON.stringify({ tour: { slots: [`t${(i % 5) + 1}`] } }),
          ],
        );
        ms.push(performance.now() - s0);
        return r.rows[0]?.outcome as string;
      }),
    );
    const wall = performance.now() - t0;
    await direct.end();
    const per = await q<{ n: number }>(
      `select count(*)::int as n from public.signup_claims where form_id = $1 group by slot`,
      [F.big],
    );
    check(
      '300 direct inserts on 40 connections: exactly 20 per tour (ok 100, slot_full 200)',
      out.filter((o) => o === 'ok').length === 100 &&
        out.filter((o) => o === 'slot_full').length === 200 &&
        per.every((r) => r.n === 20),
    );
    console.log(
      `  300 direct inserts on 40 connections: wall ${wall.toFixed(0)} ms, p50 ${pct(ms, 50).toFixed(0)} p95 ${pct(ms, 95).toFixed(0)} max ${Math.max(...ms).toFixed(0)} ms`,
    );
  }
}

async function latency() {
  const time = async (formId: string, prefix: string, answers: () => Record<string, unknown>) => {
    const ms: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const r = await submit(formId, `${prefix}.${i + 1}`, answers());
      await r.arrayBuffer().catch(() => {});
      ms.push(performance.now() - t0);
    }
    return { p50: pct(ms, 50), p95: pct(ms, 95) };
  };
  await q(`delete from public.submissions where form_id = $1`, [F.big]);
  const plain = await time(F.plain, '10.66.20', () => ({ name: 'Ada' }));
  let n = 0;
  const slots = await time(F.big, '10.66.21', () => ({ tour: { slots: [`t${(n++ % 5) + 1}`] } }));
  const look = async (slug: string, prefix: string) => {
    const ms: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      const r = await lookup(slug, `${prefix}.${i + 1}`);
      await r.arrayBuffer().catch(() => {});
      ms.push(performance.now() - t0);
    }
    return pct(ms, 50);
  };
  const lPlain = await look(SLUG.plain, '10.66.22');
  const lSlots = await look(SLUG.big, '10.66.23');
  const plan = async (sql: string, params: unknown[]) =>
    (
      (await q<{ 'QUERY PLAN': unknown }>(`explain (analyze, format json) ${sql}`, params))[0]![
        'QUERY PLAN'
      ] as Array<{ 'Execution Time': number; Plan: unknown }>
    )[0]!;
  const left1000 = await plan(
    `select public.signup_left(f.id, f.signup_slots) from public.forms f, generate_series(1, 1000) g
      where f.id = $1`,
    [F.big],
  );
  const countPlan = await plan(
    `select count(*) from public.signup_claims c where c.form_id = $1 and c.question_id = 'tour' and c.slot = 't1'`,
    [F.big],
  );
  const scanKinds =
    JSON.stringify(countPlan.Plan)
      .match(/"Node Type":"[^"]+"/g)
      ?.join(' > ') ?? '';
  console.log('\nLATENCY (ms, laptop → branch, real app in-process, 30 sequential each)');
  console.log(`  submit, no slots        p50 ${plain.p50.toFixed(1)}  p95 ${plain.p95.toFixed(1)}`);
  console.log(`  submit, taking a slot   p50 ${slots.p50.toFixed(1)}  p95 ${slots.p95.toFixed(1)}`);
  console.log(`  op=form lookup, plain   p50 ${lPlain.toFixed(1)}`);
  console.log(`  op=form lookup, 5 slots p50 ${lSlots.toFixed(1)}`);
  console.log(
    `  signup_left on the DB   ${(left1000['Execution Time'] / 1000).toFixed(3)} ms per call (1,000 calls, 5 slots)`,
  );
  console.log(
    `  counting one slot       ${countPlan['Execution Time'].toFixed(3)} ms (${scanKinds})`,
  );
}

async function rollbackAndReapply() {
  await q(rollbackSql());
  const [cols] = await q<{ n: number }>(
    `select count(*)::int as n from information_schema.columns where table_name = 'forms' and column_name = 'signup_slots'`,
  );
  // The Wave C Function's insert statement, verbatim.
  const [old] = await q<{ outcome: string }>(
    `select i.outcome, i.closed_message
       from public.insert_public_submission($1, $2, $3::jsonb, $4::jsonb) i`,
    ['s_s66rollback1', F.plain, '{"name":"Ada"}', '{}'],
  );
  await applyFile('020_signup_slots.sql');
  await applyFile('020_signup_slots.sql');
  const [again] = await q<{ n: number }>(
    `select count(*)::int as n from public.signup_claims where form_id = $1`,
    [F.swim],
  );
  check(
    'rollback restores 019’s insert (the Wave C query works), then 020 re-applies twice and backfills claims',
    cols!.n === 0 && old?.outcome === 'ok' && again!.n > 0,
    `cols ${cols!.n} outcome ${old?.outcome} claims ${again!.n}`,
  );
  // Also: the Wave C Function's query shape works against 020 itself.
  const [compat] = await q<{ outcome: string }>(
    `select i.outcome, i.closed_message
       from public.insert_public_submission($1, $2, $3::jsonb, $4::jsonb) i`,
    ['s_s66compat01', F.plain, '{"name":"Ada"}', '{}'],
  );
  check('the Wave C Function’s insert query works unchanged against 020', compat?.outcome === 'ok');
}

async function main() {
  const [has019] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
  );
  if (!has019!.n) throw new Error('019 is missing on this branch (production has it).');
  console.log('[harness] applying 020');
  await applyFile('020_signup_slots.sql');
  await applyFile('020_signup_slots.sql'); // idempotent
  await parity();
  await seed();
  process.env.DATABASE_URL = DB_URL;
  // Ten in-process copies of the Function (each its own pg pool of 5), like ten isolates.
  const path = resolve('neon/functions/submit-response/index.ts');
  apps = [];
  for (let i = 0; i < 10; i++) {
    apps.push((await import(/* @vite-ignore */ `${path}?isolate=${i}`)).default as App);
  }
  console.log(`[harness] ${new Set(apps).size} separate Function instances (a pool of 5 each)`);
  await scenarios();
  await crowds();
  await latency();
  await rollbackAndReapply();
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
