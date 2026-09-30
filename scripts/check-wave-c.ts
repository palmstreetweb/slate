/**
 * Branch harness for ADR-065 (Wave C: pins, location, availability, voice
 * notes, photo checklists): runs the REAL submitresponse and storagesign Hono
 * apps in-process against a THROWAWAY Neon branch and prints a pass/fail line
 * per scenario, plus submit latency with and without Wave C answers. Needs 019
 * (applied here if missing). No migration of its own. Not part of `npm test`.
 *
 *   CONFIRM_BRANCH=1 DATABASE_URL=<branch neondb_owner> npx vite-node scripts/check-wave-c.ts
 *
 * DATABASE_URL must never be production: the host must not contain
 * PROD_ENDPOINT (default ep-misty-snow). storagesign presigns locally with
 * placeholder Object Storage settings (nothing is uploaded; the gate and the
 * signed type and size are what's checked). Seeds owner u_s65_* and forms
 * f_s65*; every scenario uses its own X-Forwarded-For range. Cleans up after
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

const OWNER = 'u_s65_owner';
const F = { capture: 'f_s65capture01', plain: 'f_s65plain0001', voice: 'f_s65voice0001' };
const SLUG = { capture: '', plain: '', voice: '' };
const UUID = '0b8e4f5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const ref = (form: string, name: string) => `slate-file://storage:public/${form}/${UUID}/${name}`;

// A real (tiny) JPEG as the owner's uploaded pin photo, kept in the schema (ADR-065).
const PIN_PHOTO =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const outside = { field: 'where', op: 'equals', value: '__out_of_area__' };
const captureSchema = {
  brand: { name: 'Harness roofing' },
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hi' },
    {
      id: 'shots',
      type: 'photo_checklist',
      title: 'Photos',
      items: [
        { label: 'Front of the house', value: 'front' },
        { label: 'Roof close-up', value: 'roof' },
      ],
    },
    { id: 'leak', type: 'image_pin', title: 'Where?', image: PIN_PHOTO, maxPins: 3 },
    { id: 'story', type: 'voice_note', title: 'Tell us', maxSeconds: 60 },
    {
      id: 'where',
      type: 'location',
      title: 'Where’s the job?',
      center: { lat: 34.4208, lng: -119.6982 },
      radius: 25,
      radiusUnit: 'mi',
      logic: [{ if: outside, goTo: 'sorry' }],
    },
    { id: 'zipOnly', type: 'location', title: 'ZIP instead' },
    {
      id: 'when',
      type: 'availability',
      title: 'When?',
      days: ['mon', 'tue', 'sat'],
      startTime: '08:00',
      endTime: '17:00',
      slotMinutes: 60,
    },
    { id: 'addr', type: 'address', title: 'Address', serviceArea: ['931'] },
    {
      id: 'likes',
      type: 'picture_choice',
      title: 'Styles?',
      display: 'swipe',
      multiple: true,
      options: [
        { label: 'Craftsman', value: 'craft', src: 'https://example.com/a.jpg' },
        { label: 'Farmhouse', value: 'farm', src: 'https://example.com/b.jpg' },
      ],
    },
    { id: 'first', type: 'yes_no', title: 'First time?', display: 'swipe' },
    { id: 'sorry', type: 'thanks', title: 'Out of area', visibleIf: outside },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
};
const voiceSchema = {
  brand: { name: 'Harness voice' },
  questions: [
    { id: 'story', type: 'voice_note', title: 'Tell us', maxSeconds: 30 },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
};
const plainSchema = {
  brand: { name: 'Harness plain' },
  questions: [
    { id: 'where', type: 'location', title: 'Where?' },
    { id: 'when', type: 'availability', title: 'When?' },
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
  await q(`delete from public.submissions where form_id like 'f_s65%'`);
  await q(`delete from public.forms where id like 'f_s65%'`);
  await q(`delete from public.retired_slugs where owner_id like 'u_s65%'`).catch(() => {});
  await q(`delete from public.submit_rate_buckets where bucket_key like '%10.65.%'`).catch(
    () => {},
  );
  await q(`delete from public.slug_miss_buckets where ip_key like '10.65.%'`).catch(() => {});
}

async function seed() {
  for (const r of await q<{ slug: string }>('select slug from public.forms')) taken.add(r.slug);
  await cleanup();
  for (const [k, schema] of [
    ['capture', captureSchema],
    ['voice', voiceSchema],
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

let submitApp: App;
let signApp: App;
const meta = () => ({
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  durationMs: 60_000,
  questionsVisited: [],
  hiddenFields: {},
  score: 0,
});
const submit = (formId: string, ip: string, answers: Record<string, unknown>) =>
  submitApp.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ formId, answers, meta: meta() }),
  });
const lookup = (slug: string, ip: string) =>
  submitApp.request(`/?op=form&slug=${slug}`, {
    method: 'GET',
    headers: { 'X-Forwarded-For': ip },
  });
const sign = (
  formId: string,
  ip: string,
  name: string,
  contentType: string,
  contentLength: number,
) =>
  signApp.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({
      op: 'upload',
      path: `public/${formId}/${UUID}/${name}`,
      contentType,
      contentLength,
    }),
  });

async function latest(formId: string) {
  const [row] = await q<{ answers: Record<string, unknown> }>(
    `select answers from public.submissions where form_id = $1 order by received_at desc limit 1`,
    [formId],
  );
  return row!;
}

function fnv(src: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

async function scenarios() {
  // The published schema comes back with every Wave C option intact, the photo included.
  {
    const res = await lookup(SLUG.capture, '10.65.1.1');
    const b = (await res.json()) as { schema?: typeof captureSchema };
    const byId = Object.fromEntries((b.schema?.questions ?? []).map((x) => [x.id, x]));
    check(
      'op=form serves Wave C options as published (pin photo, radius, grid, swipe, checklist)',
      res.status === 200 &&
        same(byId.leak, captureSchema.questions[2]) &&
        same(byId.where, captureSchema.questions[4]) &&
        same(byId.when, captureSchema.questions[6]) &&
        (byId.likes as { display?: string })?.display === 'swipe' &&
        same(byId.shots, captureSchema.questions[1]),
    );
  }

  // A forged in-area verdict is replaced by the server's own.
  {
    const s = await submit(F.capture, '10.65.2.1', {
      where: { lat: 34.052235, lng: -118.243683, area: 'in' },
    });
    const a = (await latest(F.capture)).answers;
    check(
      'a location claiming "in" from Los Angeles is stored rounded and "out"',
      s.status === 200 && same(a.where, { lat: '34.052', lng: '-118.244', area: 'out' }),
      JSON.stringify(a.where),
    );
    await submit(F.capture, '10.65.2.2', {
      where: { lat: '34.441234', lng: '-119.812345', area: 'out' },
    });
    check(
      'a location in Goleta claiming "out" is stored "in", rounded to 3 decimals',
      same((await latest(F.capture)).answers.where, { lat: '34.441', lng: '-119.812', area: 'in' }),
    );
  }

  // A ZIP typed instead is checked against the published address areas.
  {
    await submit(F.capture, '10.65.3.1', { zipOnly: { zip: '90210', area: 'in' } });
    const a1 = (await latest(F.capture)).answers.zipOnly;
    await submit(F.capture, '10.65.3.2', { zipOnly: { zip: '93105-1234' } });
    const a2 = (await latest(F.capture)).answers.zipOnly;
    check(
      'a typed ZIP is checked against the published address ZIP list',
      same(a1, { zip: '90210', area: 'out' }) && same(a2, { zip: '931051234', area: 'in' }),
      JSON.stringify([a1, a2]),
    );
  }

  // Pins: in range, under the limit, notes aligned, the published photo's key.
  {
    await submit(F.capture, '10.65.4.1', {
      leak: {
        pins: ['0.5,0.5', '1.5,0.2', '0.25,0.75', '0.1,0.1', '0.9,0.9'],
        notes: ['leak', 'x', ' seal ', '', 'over'],
        img: 'forged',
      },
    });
    const pins = (await latest(F.capture)).answers.leak;
    check(
      'pins: out-of-range dropped, capped at 3, notes aligned, stamped with the published photo',
      same(pins, {
        pins: ['0.5,0.5', '0.25,0.75', '0.1,0.1'],
        notes: ['leak', 'seal', ''],
        img: fnv(PIN_PHOTO),
      }),
      JSON.stringify(pins),
    );
  }

  // Availability: re-encoded on the published grid.
  {
    await submit(F.capture, '10.65.5.1', {
      when: {
        mon: '09:00-10:00,10:00-12:00',
        tue: '08:30-09:30',
        sat: '16:00-18:00,08:00-09:00',
        sun: '09:00-10:00',
      },
    });
    const w = (await latest(F.capture)).answers.when;
    check(
      'availability is merged and kept to the published days and slot edges',
      same(w, { mon: '09:00-12:00', sat: '08:00-09:00' }),
      JSON.stringify(w),
    );
  }

  // Voice notes and photo checklists keep this form's own refs only.
  {
    await submit(F.capture, '10.65.6.1', {
      story: { audio: ref(F.capture, 'voice-note.webm'), sec: '4000' },
      shots: {
        front: ref(F.capture, 'front.jpg'),
        roof: ref(F.plain, 'roof.jpg'),
        panel: ref(F.capture, 'panel.jpg'),
      },
      likes: ['craft'],
      first: 'no',
    });
    const a = (await latest(F.capture)).answers;
    check(
      'a voice note keeps its own ref with a capped length; a checklist keeps only its own items and refs',
      same(a.story, { audio: ref(F.capture, 'voice-note.webm'), sec: '60' }) &&
        same(a.shots, { front: ref(F.capture, 'front.jpg') }) &&
        same(a.likes, ['craft']) &&
        a.first === 'no',
      JSON.stringify({ story: a.story, shots: a.shots }),
    );
    await submit(F.capture, '10.65.6.2', {
      story: { audio: ref(F.plain, 'voice.webm') },
      where: { typed: 'Goleta' },
    });
    const b = (await latest(F.capture)).answers;
    check(
      'another form’s recording is dropped; a typed place is kept without a verdict',
      !('story' in b) && same(b.where, { typed: 'Goleta' }),
    );
  }

  // storagesign: voice notes and checklists open public uploads, within their caps.
  {
    const webm = await sign(
      F.voice,
      '10.65.7.1',
      'voice-note.webm',
      'audio/webm;codecs=opus',
      900_000,
    );
    const webmBody = (await webm.json()) as {
      contentType?: string;
      maxBytes?: number;
      url?: string;
    };
    const mp4 = await sign(F.voice, '10.65.7.2', 'voice-note.m4a', 'audio/mp4', 900_000);
    const mp4Body = (await mp4.json()) as { contentType?: string };
    const big = await sign(F.voice, '10.65.7.3', 'voice-note.webm', 'audio/webm', 2 * 1024 * 1024);
    check(
      'storagesign signs audio/webm and audio/mp4 for a voice note, capped by its 30 s length',
      webm.status === 200 &&
        webmBody.contentType === 'audio/webm' &&
        webmBody.maxBytes === 30 * 40_000 + 64 * 1024 &&
        typeof webmBody.url === 'string' &&
        mp4Body.contentType === 'audio/mp4' &&
        big.status === 413,
      `${webm.status}/${mp4.status}/${big.status}`,
    );
    const photo = await sign(F.capture, '10.65.7.4', 'front.jpg', 'image/jpeg', 3 * 1024 * 1024);
    const huge = await sign(F.capture, '10.65.7.5', 'front.jpg', 'image/jpeg', 13 * 1024 * 1024);
    const none = await sign(F.plain, '10.65.7.6', 'x.jpg', 'image/jpeg', 1024);
    check(
      'a photo checklist opens uploads up to 12 MB; a form with no file-like question stays closed',
      photo.status === 200 && huge.status === 413 && none.status === 404,
      `${photo.status}/${huge.status}/${none.status}`,
    );
    const [charged] = await q<{ n: number }>(
      `select count(*)::int as n from public.submit_rate_buckets where bucket_key like 'up:ipowner:10.65.7.%'`,
    );
    check(
      'public voice and photo signs are charged to the IP + owner bucket (ADR-058)',
      charged!.n >= 3,
      `${charged!.n} buckets`,
    );
  }

  // The owner reads the stored answers back through RLS.
  {
    const r = await asOwner(
      `select answers->'where'->>'area' as area from public.submissions where form_id = $1 order by received_at asc limit 1`,
      [F.capture],
    );
    check(
      'the owner reads the server’s verdict through the Data API role (RLS)',
      (r.rows[0] as { area?: string })?.area === 'out',
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
  const plain = await time(F.plain, '10.65.8', {});
  const full = await time(F.capture, '10.65.9', {
    shots: { front: ref(F.capture, 'front.jpg'), roof: ref(F.capture, 'roof.jpg') },
    leak: { pins: ['0.5,0.5', '0.2,0.3'], notes: ['leak', 'seal'] },
    story: { audio: ref(F.capture, 'voice-note.webm'), sec: '42' },
    where: { lat: 34.44, lng: -119.81 },
    when: { mon: '09:00-12:00', sat: '08:00-17:00' },
    likes: ['craft', 'farm'],
    first: 'yes',
  });
  console.log('\nSUBMIT LATENCY (ms, laptop → branch, real app in-process, 30 each)');
  console.log(`  empty                 p50 ${plain.p50.toFixed(1)}  p95 ${plain.p95.toFixed(1)}`);
  console.log(`  every Wave C answer   p50 ${full.p50.toFixed(1)}  p95 ${full.p95.toFixed(1)}`);
}

async function main() {
  const [has019] = await q<{ n: number }>(
    `select count(*)::int as n from pg_proc where proname = 'insert_public_submission'`,
  );
  if (!has019!.n) {
    console.log('[harness] applying 019 (Wave A) to the branch');
    await db.query(readFileSync(resolve('neon/migrations/019_form_close.sql'), 'utf8'));
  } else {
    console.log('[harness] 019 already on the branch (production has it)');
  }
  await seed();
  process.env.DATABASE_URL = DB_URL;
  // storagesign presigns locally; placeholders, never real credentials.
  process.env.AWS_ENDPOINT_URL_S3 = 'https://storage.invalid';
  process.env.AWS_ACCESS_KEY_ID = 'harness';
  process.env.AWS_SECRET_ACCESS_KEY = 'harness';
  submitApp = (await import(resolve('neon/functions/submit-response/index.ts'))).default as App;
  signApp = (await import(resolve('neon/functions/storage-sign/index.ts'))).default as App;
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
