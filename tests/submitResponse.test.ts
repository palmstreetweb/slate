/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillUnlockToken } from '../neon/functions/submit-response/fillLock.js';
import { clampValue, keepFileRefs } from '../neon/functions/submit-response/answerShape.js';
import { addUpload, rateCalls, rateKeys, resetFnDb, type newFnDbState } from './_fnDb.js';

// ADR-058: submitresponse checks shapes, then the honeypot, then the form and
// its lock, then ONE all-or-nothing rate statement that also returns the schema.

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const FORM = 'f_abcdefghijkl';
const OTHER = 'f_otherform01';
const HASH = '$2a$08$abcdefghijklmnopqrstuuJ7gq0l1m9cQ4n3o8c5w2y1z0x9v8u7t';
const IP = '203.0.113.7';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const schema = {
  questions: [
    { id: 'q_name', type: 'short_text', title: 'Name' },
    { id: 'q_file', type: 'file_upload', title: 'Photos', maxFiles: 10 },
    { id: 'q_one', type: 'file_upload', title: 'One', multiple: false },
  ],
};

let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
let LIMITS: Record<string, number>;
const savedDb = process.env.DATABASE_URL;

function setForm(extra: Record<string, unknown> = {}, id = FORM) {
  db.state.forms.set(id, {
    id,
    name: 'Crew',
    slug: id === FORM ? 'crew-night' : `${id.replace(/_/g, '-')}`,
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner_x',
    fill_password_hash: null,
    published_schema: schema,
    ...extra,
  } as never);
}

const meta = (extra: Record<string, unknown> = {}) => ({
  startedAt: '2026-09-26T10:00:00.000Z',
  completedAt: '2026-09-26T10:01:00.000Z',
  durationMs: 60000,
  questionsVisited: ['q_name'],
  hiddenFields: {},
  ...extra,
});

function post(body: unknown, headers: Record<string, string> = { 'X-Forwarded-For': IP }) {
  return app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const submit = (
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = { 'X-Forwarded-For': IP },
) => post({ formId: FORM, answers: { q_name: 'Ada' }, meta: meta(), ...extra }, headers);

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  const mod = await import('../neon/functions/submit-response/index.js');
  app = mod.default;
  LIMITS = mod.LIMITS;
});

afterAll(() => {
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
});

beforeEach(() => {
  resetFnDb(db.state);
});

describe('submit: shapes before any DB call (ADR-058)', () => {
  it('bodies null, [], "x" and 1 are 400 with zero queries', async () => {
    for (const body of ['null', '[]', 'x', '1']) {
      expect((await post(body)).status, body).toBe(400);
    }
    expect(db.state.log).toHaveLength(0);
  });

  it('bad formId, answers, meta or unlockToken is 400 with zero queries', async () => {
    for (const formId of ['f'.repeat(65), 'f_a/b', 'f_ábc', 42, { id: FORM }, 'f_1']) {
      expect((await submit({ formId })).status, String(formId)).toBe(400);
    }
    expect((await submit({ answers: ['Ada'] })).status).toBe(400);
    expect((await submit({ meta: 'x' })).status).toBe(400);
    expect((await submit({ unlockToken: 42 })).status).toBe(400);
    expect(db.state.log).toHaveLength(0);
  });

  it('65,537 bytes of multi-byte text is 413 before parsing, chunked or not', async () => {
    const pad = 'é'.repeat(32_760); // 2 bytes each, 1 UTF-16 unit each
    const text = JSON.stringify({ formId: FORM, answers: { q_name: pad }, meta: meta() });
    const bytes = new TextEncoder().encode(text);
    expect(bytes.length).toBeGreaterThan(65_536);
    expect(text.length).toBeLessThan(65_536);
    const res = await post(text);
    expect(res.status).toBe(413);
    expect(await res.text()).toMatch(/^Your answers are too long to send/);
    const chunked = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.slice(i, i + 4096));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(413);
    expect(db.state.log).toHaveLength(0);
  });
});

describe('submit: honeypot first, free (ADR-052, ADR-058)', () => {
  it('_hp set: 200 ignored with zero queries; drops are logged once per 10 s with per-form counts', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    try {
      const trapped = meta({ hiddenFields: { _hp: '1' } });
      const first = await post({ formId: FORM, answers: {}, meta: trapped });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ id: 'ignored' });
      for (let i = 0; i < 49; i++) {
        await post({ formId: i % 2 ? FORM : OTHER, answers: {}, meta: trapped });
      }
      const lines = () => info.mock.calls.filter((c) => c[0] === '[submitresponse] honeypot drops');
      expect(lines()).toHaveLength(1);
      vi.setSystemTime(new Date('2026-09-26T12:00:11Z'));
      await post({ formId: FORM, answers: {}, meta: trapped });
      expect(lines()).toHaveLength(2);
      expect(lines()[1]![1]).toEqual({ [FORM]: 25, [OTHER]: 25 });
      expect(db.state.log).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      info.mockRestore();
    }
  });
});

describe('submit: gate before the charge (M-RL-1)', () => {
  it('unknown formId: 404 after exactly one query, no rate SQL', async () => {
    expect((await submit()).status).toBe(404);
    expect(db.state.log).toHaveLength(1);
    expect(rateCalls(db.state)).toHaveLength(0);
  });

  it('draft, deleted or schema-less forms: 404 with no rate SQL', async () => {
    for (const extra of [
      { status: 'draft' },
      { deleted_at: '2026-01-01T00:00:00Z' },
      { published_schema: null },
    ]) {
      resetFnDb(db.state);
      setForm(extra);
      expect((await submit()).status).toBe(404);
      expect(rateCalls(db.state)).toHaveLength(0);
    }
  });

  it('locked form without a token or with a wrong one: 401, no rate SQL', async () => {
    setForm({ fill_password_hash: HASH });
    expect((await submit()).status).toBe(401);
    expect((await submit({ unlockToken: 'ab'.repeat(32) })).status).toBe(401);
    expect(rateCalls(db.state)).toHaveLength(0);
    expect((await submit({ unlockToken: fillUnlockToken(FORM, HASH) })).status).toBe(200);
  });

  it('the gate never selects the schema itself', async () => {
    setForm();
    await submit();
    const gate = db.state.log[0]!.sql;
    expect(gate).not.toMatch(/published_schema\s*,/);
    expect(gate).toContain('published_schema is not null');
  });

  it('30 junk ids, then a real submit from the same IP: 200, and no rate row for the junk', async () => {
    setForm();
    for (let i = 0; i < 30; i++) {
      expect((await submit({ formId: `f_junk${String(i).padStart(6, '0')}` })).status).toBe(404);
    }
    expect(db.state.buckets.size).toBe(0);
    expect((await submit()).status).toBe(200);
  });
});

describe('submit: crowd-sized, owner-keyed charges', () => {
  it('300 submits from one IP to one form all return 200, 3 statements each', async () => {
    setForm();
    for (let i = 0; i < 300; i++) {
      const res = await submit();
      if (res.status !== 200) throw new Error(`submit ${i} → ${res.status}`);
    }
    expect(db.state.submissions).toHaveLength(300);
    expect(db.state.log).toHaveLength(900);
    expect(db.state.buckets.get(`sub:ipowner:${IP}:u_owner_x`)!.count).toBe(300);
  });

  it('a 1.5 KB body costs 1 unit and a 20 KB body costs 5', async () => {
    setForm();
    await submit({ answers: { q_name: 'a'.repeat(1300) } });
    await submit({ answers: { q_name: 'a'.repeat(19_800) } });
    expect(rateCalls(db.state).map((q) => (q.params[3] as number[])[0])).toEqual([1, 5]);
  });

  it('owner isolation: a full IP + owner bucket refuses that owner only', async () => {
    setForm();
    setForm({ owner_id: 'u_owner_y' }, OTHER);
    db.state.buckets.set(`sub:ipowner:${IP}:u_owner_x`, { start: Date.now(), count: 2000 });
    const denied = await submit();
    expect(denied.status).toBe(429);
    const body = (await denied.json()) as { error: string; retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(3500);
    expect(body.error).toMatch(/^Too many responses .*mobile data/);
    expect(denied.headers.get('Retry-After')).toBe(String(body.retryAfterSeconds));
    expect(denied.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect((await submit({ formId: OTHER })).status).toBe(200);
    expect((await submit({}, { 'X-Forwarded-For': '198.51.100.1' })).status).toBe(200);
  });

  it('with two buckets full, the 429 reports the longer wait', async () => {
    setForm();
    const now = Date.now();
    db.state.buckets.set(`sub:ipowner:${IP}:u_owner_x`, { start: now - 3000_000, count: 2000 });
    db.state.buckets.set(`sub:ip:${IP}`, { start: now - 60_000, count: 10_000 });
    const res = await submit();
    expect(res.status).toBe(429);
    const { retryAfterSeconds } = (await res.json()) as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(3400);
  });

  it('every key stays ≤ 170 bytes across fuzzed XFF, form ids and owner ids', async () => {
    const xffs = [
      IP,
      '2001:db8:1:2:aaaa:bbbb:cccc:dddd',
      `1.1.1.1, ${'z'.repeat(5000)}`,
      '<script>'.repeat(50),
      '[ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]:65535',
    ];
    const owners = ['u'.repeat(64), 'x/'.repeat(500), '😀'.repeat(100), null];
    let n = 0;
    for (const owner of owners) {
      const id = `f_${'Z'.repeat(62)}`;
      setForm({ owner_id: owner }, id);
      for (const xff of xffs) {
        await submit({ formId: id }, { 'X-Forwarded-For': xff });
        n += 1;
      }
    }
    const keys = rateKeys(db.state);
    expect(keys.length).toBe(n * 2);
    for (const k of keys) expect(Buffer.byteLength(k, 'utf8')).toBeLessThanOrEqual(170);
  });

  it('no X-Forwarded-For: keys use noip and the maxes are one tenth', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setForm();
    await submit({}, {});
    const call = rateCalls(db.state)[0]!;
    expect(call.params[0]).toEqual(['sub:ipowner:noip:u_owner_x', 'sub:ip:noip']);
    expect(call.params[2]).toEqual([200, 1000]);
    err.mockRestore();
  });
});

describe('submit: failures', () => {
  it('gate throws → 503; rate call throws → 503; insert throws → 500', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setForm();
    db.state.fail = { gate: true };
    expect((await submit()).status).toBe(503);
    db.state.fail = { rate: true };
    expect((await submit()).status).toBe(503);
    db.state.fail = { insert: true };
    expect((await submit()).status).toBe(500);
    err.mockRestore();
  });

  it('LIMITS equal the ADR-058 table', () => {
    expect(LIMITS).toEqual({
      ipOwner: 2000,
      ip: 10000,
      pw: 2000,
      pwIp: 10000,
      failIp: 500,
      failForm: 300,
      formMiss: 300,
    });
  });

  it('bad env values keep the default', async () => {
    for (const v of ['', 'abc', '0']) {
      vi.resetModules();
      vi.stubEnv('SUBMIT_RATE_IP_OWNER_MAX', v);
      const mod = await import('../neon/functions/submit-response/index.js');
      expect(mod.LIMITS.ipOwner).toBe(2000);
      vi.unstubAllEnvs();
    }
  });

  it('OPTIONS carries Access-Control-Max-Age: 7200', async () => {
    const res = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://slate.test', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Max-Age')).toBe('7200');
  });

  it('questionsVisited items of 100 characters are stored as 64', async () => {
    setForm();
    await submit({ meta: meta({ questionsVisited: ['q'.repeat(100)] }) });
    const stored = db.state.submissions[0]!.meta as { questionsVisited: string[] };
    expect(stored.questionsVisited[0]).toHaveLength(64);
  });
});

describe('file answers keep only this form’s refs (C4)', () => {
  const ref = (scope: 'public' | 'draft', form = FORM, uuid = UUID, name = 'photo.jpg') =>
    `slate-file://storage:${scope}/${form}/${uuid}/${name}`;
  const uuids = (n: number) =>
    Array.from({ length: n }, (_, i) => `0f8fad5b-d9cb-469f-a165-${String(i).padStart(12, '0')}`);

  it('11 valid refs on maxFiles 10: the first 10; duplicates removed', () => {
    const refs = uuids(11).map((u) => ref('public', FORM, u));
    expect(keepFileRefs(refs, FORM, { maxFiles: 10 })).toEqual(refs.slice(0, 10));
    expect(keepFileRefs([refs[0], refs[0], refs[1]], FORM, {})).toEqual([refs[0], refs[1]]);
  });

  it('multiple:false keeps the first valid ref as a string', () => {
    const refs = uuids(3).map((u) => ref('public', FORM, u));
    expect(keepFileRefs(['https://x.example/a.jpg', ...refs], FORM, { multiple: false })).toBe(
      refs[0],
    );
  });

  it('a same-form draft/ ref is kept; everything else is dropped', () => {
    expect(keepFileRefs([ref('draft')], FORM, {})).toEqual([ref('draft')]);
    const junk = [
      ref('public', OTHER),
      ref('draft', OTHER),
      'https://evil.example/beacon.png',
      'slate-file://abc',
      ref('public', FORM, '0f8fad5b-d9cb-469f-a165-70867728950'),
      ref('public', FORM, UUID, 'n'.repeat(121)),
      42,
      { ref: ref('public') },
    ];
    expect(keepFileRefs(junk, FORM, {})).toBeUndefined();
  });

  it('100 shape-valid refs on a default question: 10 stored', () => {
    const refs = uuids(100).map((u) => ref('public', FORM, u));
    expect(keepFileRefs(refs, FORM, {})).toHaveLength(10);
  });

  it('a ref built like uploadToNeonStorage passes for both scopes', () => {
    const name = 'My receipt (1).pdf'.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
    for (const scope of ['public', 'draft'] as const) {
      const r = `slate-file://storage:${scope}/${FORM}/${crypto.randomUUID()}/${name}`;
      expect(keepFileRefs([r], FORM, {})).toEqual([r]);
    }
  });

  it('end to end: stored answers keep only valid refs; non-file answers are clampValue output', async () => {
    setForm();
    const good = ref('public');
    // ADR-067: every ref must be an upload storagesign recorded for this form.
    addUpload(db.state, { key: good.slice(21), owner_id: 'u_owner_x', question_id: 'q_file' });
    addUpload(db.state, { key: ref('draft').slice(21), owner_id: 'u_owner_x', question_id: null });
    const answers = {
      q_name: 'x'.repeat(12_000),
      q_file: [good, 'https://x.example/a.png'],
      q_one: [ref('draft'), good],
    };
    expect((await submit({ answers })).status).toBe(200);
    expect(db.state.submissions[0]!.answers).toEqual({
      q_name: clampValue(answers.q_name),
      q_file: [good],
      q_one: ref('draft'),
    });
  });

  // ADR-067: dropping another form's ref (ADR-058) became a refusal — the page never sends one.
  it('another form’s ref in a file answer is a 400 and nothing is stored', async () => {
    setForm();
    const res = await submit({ answers: { q_file: [ref('public', OTHER)] } });
    expect(res.status).toBe(400);
    expect(db.state.submissions).toHaveLength(0);
    expect(db.state.log.some((q) => q.sql.includes('insert_public_submission'))).toBe(false);
  });
});

describe('unlock (C5)', () => {
  const unlock = (
    body: Record<string, unknown>,
    headers: Record<string, string> = { 'X-Forwarded-For': IP },
  ) => post({ op: 'unlock', slug: 'crew-night', ...body }, headers);
  const tryCalls = () => db.state.log.filter((q) => q.sql.includes('try_fill_password'));

  it('malformed slug, password or token: 401 wrong_password with zero queries', async () => {
    for (const slug of ['Crew', 'a--b', 'a'.repeat(65), 'crеw', '']) {
      const res = await unlock({ slug, password: 'secret' });
      expect(res.status, slug).toBe(401);
      expect(await res.json()).toEqual({ error: 'wrong_password' });
    }
    expect((await unlock({ password: '€'.repeat(25) })).status).toBe(401);
    expect((await unlock({ password: 123456 })).status).toBe(401);
    expect((await unlock({ password: 'secret', token: {} })).status).toBe(401);
    expect(db.state.log).toHaveLength(0);
  });

  it('unknown slug: 401 after one query, no try call', async () => {
    expect((await unlock({ password: 'secret' })).status).toBe(401);
    expect(db.state.log).toHaveLength(1);
    expect(tryCalls()).toHaveLength(0);
  });

  it('unlocked form: 200 with the schema from the throttled lookup (017), published title', async () => {
    setForm({ name: 'Live rename', published_name: 'Crew' });
    const res = await unlock({});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ locked: false, schema, name: 'Crew' });
    expect(db.state.log).toHaveLength(1);
    expect(db.state.log[0]!.sql).toMatch(/lookup_public_form\(\$1, \$2, \$3, \$4\)/);
    expect(db.state.log[0]!.params).toEqual(['crew-night', IP, 300, 600]);
  });

  it('valid token: 200 with one extra schema query, no try; wrong token and no password: 401', async () => {
    setForm({ fill_password_hash: HASH });
    const token = fillUnlockToken(FORM, HASH);
    const res = await unlock({ token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ locked: true, schema, unlockToken: token });
    expect(db.state.log).toHaveLength(2);
    expect(tryCalls()).toHaveLength(0);
    expect((await unlock({ token: 'ab'.repeat(32) })).status).toBe(401);
    expect(tryCalls()).toHaveLength(0);
  });

  it('trims and NFC-normalizes the password, and passes the ADR-058 limits', async () => {
    setForm({ fill_password_hash: HASH });
    db.state.tryFill = () => ({ ok: false, denied: null, retry_after_seconds: 0 });
    await unlock({ password: '  Spring-Fair  ' });
    await unlock({ password: 'café' });
    expect(tryCalls()).toHaveLength(2);
    expect(tryCalls()[0]!.params).toEqual([
      HASH,
      'Spring-Fair',
      IP,
      'u_owner_x',
      FORM,
      2000,
      10000,
      500,
      300,
    ]);
    expect(tryCalls()[1]!.params[1]).toBe('café');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await unlock({ password: 'secret' }, {});
    err.mockRestore();
    expect(tryCalls()[2]!.params.slice(2)).toEqual(['noip', 'u_owner_x', FORM, 200, 1000, 50, 300]);
  });

  it.each([
    ['fail_ip', /^Too many wrong passwords from this network/],
    ['fail_form', /^Too many wrong passwords for this form/],
    ['pw', /^Too many password attempts .*mobile data/],
  ])('denied %s: 429 with the matching copy', async (reason, copy) => {
    setForm({ fill_password_hash: HASH });
    db.state.tryFill = () => ({ ok: false, denied: reason, retry_after_seconds: 1800 });
    const res = await unlock({ password: 'secret' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1800');
    const body = (await res.json()) as { error: string; reason: string; retryAfterSeconds: number };
    expect(body.error).toMatch(copy);
    expect(body.error).toContain('about 30 minutes');
    expect(body.reason).toBe(reason);
    expect(body.retryAfterSeconds).toBe(1800);
  });

  it('ok: 200 with the schema and token; not ok: 401', async () => {
    setForm({ fill_password_hash: HASH });
    db.state.tryFill = () => ({ ok: true, denied: null, retry_after_seconds: 0 });
    const res = await unlock({ password: 'secret' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      locked: true,
      schema,
      unlockToken: fillUnlockToken(FORM, HASH),
    });
    db.state.tryFill = () => ({ ok: false, denied: null, retry_after_seconds: 0 });
    expect((await unlock({ password: 'wrong1' })).status).toBe(401);
  });

  it('try throws: 401 byte-identical to a wrong password; the lookup throws: 503', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setForm({ fill_password_hash: HASH });
    db.state.tryFill = () => ({ ok: false, denied: null, retry_after_seconds: 0 });
    const wrong = await unlock({ password: 'wrong1' });
    db.state.fail = { try: true };
    const broken = await unlock({ password: 'wrong1' });
    expect(broken.status).toBe(401);
    expect(await broken.text()).toBe(await wrong.text());
    db.state.fail = { gate: true };
    expect((await unlock({ password: 'wrong1' })).status).toBe(503);
    err.mockRestore();
  });
});

describe('form lookup: GET ?op=form (ADR-061)', () => {
  const get = (
    slug: string | null,
    headers: Record<string, string> = { 'X-Forwarded-For': IP },
    op: string | null = 'form',
  ) => {
    const q = new URLSearchParams();
    if (op !== null) q.set('op', op);
    if (slug !== null) q.set('slug', slug);
    return app.request(`/?${q}`, { method: 'GET', headers });
  };
  const unlock = (
    body: Record<string, unknown>,
    headers: Record<string, string> = { 'X-Forwarded-For': IP },
  ) => post({ op: 'unlock', slug: 'crew-night', ...body }, headers);
  const lookups = () => db.state.log.filter((q) => q.sql.includes('lookup_public_form'));
  const writes = () => db.state.log.filter((q) => !q.sql.includes('lookup_public_form'));

  it('open form: 200 with the published title and schema, one statement, no-store', async () => {
    setForm({ name: 'Live rename', published_name: 'Crew' });
    const res = await get('crew-night');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      id: FORM,
      name: 'Crew',
      slug: 'crew-night',
      locked: false,
      schema,
    });
    expect(db.state.log).toHaveLength(1);
    expect(lookups()[0]!.params).toEqual(['crew-night', IP, 300, 600]);
  });

  it('locked form: 200 with the published title, no schema, and never the hash or owner', async () => {
    setForm({ name: 'Secret live name', published_name: 'Crew', fill_password_hash: HASH });
    const res = await get('crew-night');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id: FORM,
      name: 'Crew',
      slug: 'crew-night',
      locked: true,
      schema: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/Secret|\$2a\$|u_owner_x/);
  });

  it('no published_name (pre-017 row): the published brand name, never the live name', async () => {
    setForm({
      name: 'Secret live name',
      published_schema: { ...schema, brand: { name: 'Crew brand' } },
    });
    expect(await (await get('crew-night')).json()).toMatchObject({ name: 'Crew brand' });
  });

  it('unknown, draft and trashed slugs are the same 404; repeats of one miss count once', async () => {
    setForm({ status: 'draft' });
    setForm({ deleted_at: '2026-09-01T00:00:00Z' }, OTHER);
    for (const slug of ['crew-night', OTHER.replace(/_/g, '-'), '12345678']) {
      const res = await get(slug);
      expect(res.status, slug).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
    for (let i = 0; i < 50; i++) await get('12345678');
    expect(db.state.misses.get(IP)!.slugs.size).toBe(3);
    expect(writes()).toHaveLength(0);
  });

  it('malformed slug or missing op: 404 with zero queries', async () => {
    for (const slug of ['', 'Crew', 'a--b', 'a'.repeat(65), 'crеw', '../x', null]) {
      expect((await get(slug)).status, String(slug)).toBe(404);
    }
    expect((await get('crew-night', { 'X-Forwarded-For': IP }, null)).status).toBe(404);
    expect((await get('crew-night', { 'X-Forwarded-For': IP }, 'unlock')).status).toBe(404);
    expect(db.state.log).toHaveLength(0);
  });

  it('scanner: 300 distinct misses, then 429 for misses AND hits; other networks unaffected', async () => {
    setForm();
    for (let i = 0; i < 300; i++) {
      expect((await get(String(20_000_000 + i))).status).toBe(404);
    }
    const next = await get('99999999');
    expect(next.status).toBe(429);
    expect(next.headers.get('Retry-After')).toBe('600');
    const body = (await next.json()) as {
      error: string;
      reason: string;
      retryAfterSeconds: number;
    };
    expect(body.error).toMatch(/^Too many links to forms .* about 10 minutes\. .*mobile data\.$/);
    expect(body).toMatchObject({ reason: 'lookup', retryAfterSeconds: 600 });
    expect((await get('crew-night')).status).toBe(429);
    expect(db.state.misses.get(IP)!.slugs.size).toBe(300);
    expect((await get('crew-night', { 'X-Forwarded-For': '198.51.100.9' })).status).toBe(200);
  });

  it('venue: 300 opens and 30 typos from one IP are never refused', async () => {
    setForm();
    let refused = 0;
    for (let i = 0; i < 330; i++) {
      const res = await get(i % 11 === 10 ? String(30_000_000 + i) : 'crew-night');
      if (res.status === 429) refused += 1;
    }
    expect(refused).toBe(0);
    expect(db.state.misses.get(IP)!.slugs.size).toBe(30);
  });

  it('the window resets after 10 minutes', async () => {
    setForm();
    db.state.now = Date.parse('2026-09-28T10:00:00Z');
    for (let i = 0; i < 300; i++) await get(String(40_000_000 + i));
    expect((await get('crew-night')).status).toBe(429);
    db.state.now += 601_000;
    expect((await get('crew-night')).status).toBe(200);
  });

  it('no X-Forwarded-For: the noip key at a tenth of the budget', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await get('12345678', {});
    err.mockRestore();
    expect(lookups()[0]!.params).toEqual(['12345678', 'noip', 30, 600]);
  });

  it('the lookup throws: 503', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.state.fail = { gate: true };
    expect((await get('crew-night')).status).toBe(503);
    err.mockRestore();
  });

  it('a GET is a CORS simple request: allowed for any origin, Retry-After readable', async () => {
    setForm();
    const res = await app.request('/?op=form&slug=crew-night', {
      method: 'GET',
      headers: { Origin: 'https://slateforms.vercel.app', 'X-Forwarded-For': IP },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Expose-Headers')).toMatch(/Retry-After/);
  });

  it('unlock shares the budget: unknown slugs charge a miss, and an IP over budget gets the lookup 429', async () => {
    setForm({ fill_password_hash: HASH });
    expect((await unlock({ slug: '55555555', password: 'secret' })).status).toBe(401);
    expect(db.state.misses.get(IP)!.slugs.has('55555555')).toBe(true);
    for (let i = 0; i < 299; i++) await get(String(60_000_000 + i));
    const token = fillUnlockToken(FORM, HASH);
    const res = await unlock({ token });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: 'lookup' });
    expect(db.state.log.filter((q) => q.sql.includes('try_fill_password'))).toHaveLength(0);
    expect((await unlock({ token }, { 'X-Forwarded-For': '198.51.100.9' })).status).toBe(200);
  });

  it('unlock answers with the published title too', async () => {
    setForm({ name: 'Secret live name', published_name: 'Crew', fill_password_hash: HASH });
    const res = await unlock({ token: fillUnlockToken(FORM, HASH) });
    expect(await res.json()).toMatchObject({ name: 'Crew', locked: true });
  });

  it('FORM_LOOKUP_MISS_MAX overrides the budget; bad values keep 300', async () => {
    for (const [v, want] of [
      ['50', 50],
      ['abc', 300],
      ['0', 300],
    ] as const) {
      vi.resetModules();
      vi.stubEnv('FORM_LOOKUP_MISS_MAX', v);
      const mod = await import('../neon/functions/submit-response/index.js');
      expect(mod.LIMITS.formMiss).toBe(want);
      vi.unstubAllEnvs();
    }
  });
});

describe('the Function’s own connection has a ceiling (audit 2026-10, ADR-071)', () => {
  it('SETs statement_timeout 8 s and lock_timeout 4 s on every new connection, with a client-side query_timeout backstop', async () => {
    expect(db.state.poolConfig).toMatchObject({ query_timeout: 10_000 });
    // Tests that re-import the module build another pool each time; every one registers it.
    const connect = db.state.poolEvents.filter((e) => e.event === 'connect');
    expect(connect.length).toBeGreaterThan(0);
    const query = vi.fn<(sql: string) => Promise<{ rows: unknown[] }>>(async () => ({ rows: [] }));
    await connect.at(-1)!.handler({ query });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]![0]);
    expect(sql).toMatch(/set statement_timeout = 8000/);
    expect(sql).toMatch(/set lock_timeout = 4000/);
  });
});
