/** @vitest-environment node */
/**
 * Closing a form (ADR-063) in the submit Function, against the in-memory
 * stand-in for 019: the lookup reports closed forms without a schema, a form
 * past its closing time is refused before any charge, and the cap is enforced
 * by the insert. Also the per-type answer clamps.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OTHER_MAX, clampForQuestion } from '../neon/functions/submit-response/answerShape.js';
import { rateCalls, resetFnDb, type newFnDbState } from './_fnDb.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const FORM = 'f_closetest001';
const SLUG = '41234567';
const IP = '203.0.113.9';
const schema = {
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
    { id: 'when', type: 'date', title: 'When?', range: true },
  ],
};

let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
let CLOSED_COPY: Record<'date' | 'full', string>;
const savedDb = process.env.DATABASE_URL;

function setForm(extra: Record<string, unknown> = {}) {
  db.state.forms.set(FORM, {
    id: FORM,
    name: 'Pool party',
    published_name: 'Pool party',
    slug: SLUG,
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner_close',
    fill_password_hash: null,
    published_schema: schema,
    ...extra,
  } as never);
}

const meta = {
  startedAt: '2026-09-29T10:00:00.000Z',
  completedAt: '2026-09-29T10:01:00.000Z',
  durationMs: 60000,
  questionsVisited: ['name'],
  hiddenFields: { src: 'mailbox-flyer' },
};

const submit = (answers: Record<string, unknown> = { name: 'Ada' }) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
    body: JSON.stringify({ formId: FORM, answers, meta }),
  });

const lookup = () =>
  app.request(`/?op=form&slug=${SLUG}`, { method: 'GET', headers: { 'X-Forwarded-For': IP } });

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  const mod = await import('../neon/functions/submit-response/index.js');
  app = mod.default;
  CLOSED_COPY = mod.CLOSED_COPY;
});

afterAll(() => {
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
});

beforeEach(() => {
  resetFnDb(db.state);
});

describe('closing time', () => {
  it('an open form takes responses and keeps the source in hiddenFields', async () => {
    setForm({ closes_at: new Date(Date.now() + 3600_000).toISOString() });
    const res = await submit();
    expect(res.status).toBe(200);
    expect(db.state.submissions).toHaveLength(1);
    expect((db.state.submissions[0]!.meta as typeof meta).hiddenFields).toEqual({
      src: 'mailbox-flyer',
    });
  });

  it('past the closing time: 410 with the copy and the owner message, nothing charged or stored', async () => {
    setForm({
      closes_at: new Date(Date.now() - 1000).toISOString(),
      closed_message: 'See you next summer!',
    });
    const res = await submit();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: CLOSED_COPY.date,
      reason: 'date',
      message: 'See you next summer!',
    });
    expect(rateCalls(db.state)).toHaveLength(0);
    expect(db.state.submissions).toHaveLength(0);
    // One read, like every gate refusal.
    expect(db.state.log).toHaveLength(1);
  });

  it('the lookup reports a closed form and sends no schema', async () => {
    setForm({ closes_at: new Date(Date.now() - 1000).toISOString() });
    const res = await lookup();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: FORM,
      name: 'Pool party',
      locked: false,
      schema: null,
      closed: { reason: 'date', message: null },
    });
  });

  it('a locked, closed form says closed (no password to type for nothing)', async () => {
    setForm({
      closes_at: new Date(Date.now() - 1000).toISOString(),
      fill_password_hash: '$2a$08$abcdefghijklmnopqrstuuJ7gq0l1m9cQ4n3o8c5w2y1z0x9v8u7t',
    });
    const body = (await (await lookup()).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ locked: true, schema: null, closed: { reason: 'date' } });
    const unlock = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
      body: JSON.stringify({ op: 'unlock', slug: SLUG, password: 'anything-1' }),
    });
    expect(unlock.status).toBe(200);
    expect(await unlock.json()).toMatchObject({ schema: null, closed: { reason: 'date' } });
    expect(db.state.log.some((q) => q.sql.includes('try_fill_password'))).toBe(false);
  });

  it('an open form still returns its schema and no closed field', async () => {
    setForm();
    const body = (await (await lookup()).json()) as Record<string, unknown>;
    expect(body.schema).toEqual(schema);
    expect(body).not.toHaveProperty('closed');
  });
});

describe('response cap', () => {
  it('takes responses up to the cap, then answers 409 with the copy', async () => {
    setForm({ max_responses: 2, closed_message: 'All 2 spots are taken.' });
    expect((await submit()).status).toBe(200);
    expect((await submit()).status).toBe(200);
    const third = await submit();
    expect(third.status).toBe(409);
    expect(await third.json()).toEqual({
      error: CLOSED_COPY.full,
      reason: 'full',
      message: 'All 2 spots are taken.',
    });
    expect(db.state.submissions).toHaveLength(2);
    // Still 3 statements for an accepted or capped submit: gate, rate, insert.
    expect(db.state.log.filter((q) => q.sql.includes('insert_public_submission'))).toHaveLength(3);
  });

  it('trashed responses free their spot', async () => {
    setForm({ max_responses: 1 });
    expect((await submit()).status).toBe(200);
    db.state.submissions[0]!.deleted_at = new Date().toISOString();
    expect((await submit()).status).toBe(200);
  });

  it('the lookup reports a full form', async () => {
    setForm({ max_responses: 1 });
    await submit();
    const body = (await (await lookup()).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ schema: null, closed: { reason: 'full', message: null } });
  });

  it('a form without a cap never reports full', async () => {
    setForm();
    for (let i = 0; i < 5; i++) await submit();
    const body = (await (await lookup()).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('closed');
  });

  it('an unexpected insert outcome fails closed with a 500', async () => {
    setForm();
    db.state.fail.insert = true;
    expect((await submit()).status).toBe(500);
  });
});

describe('per-type answer clamps (ADR-063)', () => {
  it('stores typed Other text capped, numbers as numbers, dates as short strings', async () => {
    setForm();
    const res = await submit({
      name: 'Ada',
      src: 'y'.repeat(900),
      n: '12',
      when: '2026-10-03/2026-10-07',
    });
    expect(res.status).toBe(200);
    const stored = db.state.submissions[0]!.answers as Record<string, unknown>;
    expect((stored.src as string).length).toBe(OTHER_MAX);
    expect(stored.n).toBe(12);
    expect(stored.when).toBe('2026-10-03/2026-10-07');
  });

  it('clampForQuestion drops what the engine never sends', () => {
    expect(clampForQuestion({ type: 'number' }, 'lots')).toBeUndefined();
    expect(clampForQuestion({ type: 'scale' }, Number.NaN)).toBeUndefined();
    expect(clampForQuestion({ type: 'nps' }, 7)).toBe(7);
    expect(clampForQuestion({ type: 'date' }, 'x'.repeat(41))).toBeUndefined();
    expect(clampForQuestion({ type: 'date' }, { start: 'a' })).toBeUndefined();
    const multi = {
      type: 'multi_choice',
      allowOther: true,
      options: [{ value: 'a' }, { value: 'b' }],
    };
    // SRV-1 changed this on purpose: only the first entry that wasn't an option
    // was kept. A page loaded before the owner removed an option sends that
    // option beside the typed text, so every such entry is kept as text, once.
    expect(clampForQuestion(multi, ['a', 'typed one', 'typed two', 'b', 'typed one'])).toEqual([
      'a',
      'typed one',
      'typed two',
      'b',
    ]);
    // Without allowOther the same (SRV-1; CH-16 had dropped it): a value the
    // question doesn't list is an option removed since, cut like Other text.
    expect(clampForQuestion({ type: 'single_choice', options: [] }, 'z'.repeat(900))).toBe(
      'z'.repeat(OTHER_MAX),
    );
  });
});
