/** @vitest-environment node */
/**
 * The submit Function and sign-up slots (ADR-066), against the in-memory
 * stand-in for migration 020 (tests/_fnDb.ts): the canonical slot clamp,
 * spots left on the public lookup (counts only, never for a locked form
 * before its unlock), a spot taken per submit, and a 409 naming the full slot
 * with nothing stored. The real database behaviour — exact under 300
 * concurrent submits — is scripts/check-signup-slots.ts on a Neon branch.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampForQuestion } from '../neon/functions/submit-response/answerShape.js';
import { resetFnDb, slotsLeft, type newFnDbState } from './_fnDb.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const FORM = 'f_waved000001';
const SLUG = '12345681';
const IP = '203.0.113.66';

const schema = {
  brand: { name: 'Pool' },
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    {
      id: 'swim',
      type: 'signup_slots',
      title: 'Pick a time',
      waitlist: true,
      maxPicks: 2,
      slots: [
        { label: 'Morning swim', value: 's_am', capacity: 3 },
        { label: 'Lunch swim', value: 's_noon', capacity: 1 },
        { label: '', value: 's_pm', capacity: 2 },
      ],
    },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
};

let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
let slotsLeftOf: (raw: unknown) => unknown;
const savedDb = process.env.DATABASE_URL;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  const mod = await import('../neon/functions/submit-response/index.js');
  app = mod.default;
  slotsLeftOf = mod.slotsLeftOf;
});

afterAll(() => {
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
});

beforeEach(() => {
  resetFnDb(db.state);
  db.state.forms.set(FORM, {
    id: FORM,
    name: 'Pool party',
    slug: SLUG,
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner_d',
    fill_password_hash: null,
    published_schema: schema,
  });
});

const submit = (answers: Record<string, unknown>) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
    body: JSON.stringify({
      formId: FORM,
      answers,
      meta: {
        startedAt: '2026-09-30T10:00:00.000Z',
        completedAt: '2026-09-30T10:02:00.000Z',
        durationMs: 120000,
        questionsVisited: [],
        hiddenFields: {},
        score: 0,
      },
    }),
  });
const lookup = (part = '') =>
  app.request(`/?op=form&slug=${SLUG}${part ? `&part=${part}` : ''}`, {
    method: 'GET',
    headers: { 'X-Forwarded-For': IP },
  });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('clampForQuestion: sign-up slots', () => {
  const swim = schema.questions[1] as Record<string, unknown>;

  it('keeps published slots once, at most the question’s picks, waitlists only when it has one', () => {
    expect(clampForQuestion(swim, { slots: ['s_am', 'forged', 's_am', 's_noon', 's_pm'] })).toEqual(
      {
        slots: ['s_am', 's_noon'],
      },
    );
    expect(clampForQuestion(swim, { slots: [], wait: ['s_noon'] })).toEqual({
      slots: [],
      wait: ['s_noon'],
    });
    expect(
      clampForQuestion({ ...swim, waitlist: false }, { slots: [], wait: ['s_noon'] }),
    ).toBeUndefined();
    expect(clampForQuestion(swim, 's_am')).toBeUndefined();
    expect(clampForQuestion(swim, { slots: [{ evil: 1 }] })).toBeUndefined();
  });
});

describe('the public lookup: spots left, counts only', () => {
  it('op=form carries every slot’s spots left with the schema', async () => {
    const b = await json(await lookup());
    expect(b.slotsLeft).toEqual({ swim: { s_am: 3, s_noon: 1, s_pm: 2 } });
    expect(b.schema).toBeTruthy();
  });

  it('part=slots sends the counts alone', async () => {
    const b = await json(await lookup('slots'));
    expect(b).toEqual({
      id: FORM,
      locked: false,
      slotsLeft: { swim: { s_am: 3, s_noon: 1, s_pm: 2 } },
    });
  });

  it('a locked form: no counts until the unlock', async () => {
    db.state.forms.get(FORM)!.fill_password_hash = '$2a$08$abcdefghijklmnopqrstuv';
    const b = await json(await lookup());
    const part = await json(await lookup('slots'));
    expect(b.locked).toBe(true);
    expect(b).not.toHaveProperty('slotsLeft');
    expect(part).not.toHaveProperty('slotsLeft');
  });

  it('a form without slots has none; a closed form sends no counts', async () => {
    db.state.forms.get(FORM)!.published_schema = { brand: { name: 'x' }, questions: [] };
    expect(await json(await lookup())).not.toHaveProperty('slotsLeft');
    db.state.forms.get(FORM)!.published_schema = schema;
    db.state.forms.get(FORM)!.closes_at = '2020-01-01T00:00:00.000Z';
    const closed = await json(await lookup());
    expect(closed.closed).toBeTruthy();
    expect(closed).not.toHaveProperty('slotsLeft');
  });

  it('the counts are sanitised before they go out', () => {
    expect(
      slotsLeftOf({
        swim: { a: 3, b: -1, c: 2.5, d: '4', toString: 1 },
        __proto__: { x: 1 },
        bad: 'x',
      }),
    ).toEqual({ swim: { a: 3 } });
    expect(slotsLeftOf(null)).toBeUndefined();
    expect(slotsLeftOf([1])).toBeUndefined();
  });
});

describe('submit: taking spots', () => {
  it('takes a spot; the lookup counts it', async () => {
    const r = await submit({ name: 'Ada', swim: { slots: ['s_noon'] } });
    expect(r.status).toBe(200);
    expect(slotsLeft(db.state, db.state.forms.get(FORM)!)).toEqual({
      swim: { s_am: 3, s_noon: 0, s_pm: 2 },
    });
    expect((await json(await lookup())).slotsLeft).toEqual({
      swim: { s_am: 3, s_noon: 0, s_pm: 2 },
    });
  });

  it('a full slot is a 409 slot_full naming it, with fresh counts, and nothing is stored', async () => {
    await submit({ name: 'Ada', swim: { slots: ['s_noon'] } });
    const r = await submit({ name: 'Grace', swim: { slots: ['s_am', 's_noon'] } });
    expect(r.status).toBe(409);
    const b = await json(r);
    expect(b.reason).toBe('slot_full');
    expect(b.full).toEqual([{ question: 'swim', slot: 's_noon', label: 'Lunch swim' }]);
    expect(b.slotsLeft).toEqual({ swim: { s_am: 3, s_noon: 0, s_pm: 2 } });
    expect(b.error).toMatch(/^Lunch swim just filled up/);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(db.state.submissions).toHaveLength(1);
  });

  it('an unnamed slot still gets a plain message', async () => {
    await submit({ swim: { slots: ['s_pm'] } });
    await submit({ swim: { slots: ['s_pm'] } });
    const b = await json(await submit({ swim: { slots: ['s_pm'] } }));
    expect(b.full).toEqual([{ question: 'swim', slot: 's_pm', label: '' }]);
    expect(b.error).toMatch(/^A spot you picked just filled up/);
  });

  it('a waitlist takes no spot; trashing a response frees one', async () => {
    await submit({ name: 'Ada', swim: { slots: ['s_noon'] } });
    expect((await submit({ name: 'Kay', swim: { slots: [], wait: ['s_noon'] } })).status).toBe(200);
    expect(db.state.submissions[1]!.answers).toEqual({
      name: 'Kay',
      swim: { slots: [], wait: ['s_noon'] },
    });
    expect((await submit({ swim: { slots: ['s_noon'] } })).status).toBe(409);
    db.state.submissions[0]!.deleted_at = '2026-09-30T11:00:00.000Z';
    expect((await submit({ name: 'Grace', swim: { slots: ['s_noon'] } })).status).toBe(200);
  });

  it('a forged slot value never takes a spot', async () => {
    const r = await submit({ swim: { slots: ['s_forged'] } });
    expect(r.status).toBe(200);
    expect(db.state.submissions[0]!.answers).toEqual({});
  });
});
