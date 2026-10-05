/** @vitest-environment node */
/**
 * QA pass (w4a): the submit Function keeps choice answers inside the published
 * rules with the engine's own clamp (CH-16), keeps every published matrix row
 * and every character the page accepted (GAP-14), and keeps typed text on a
 * voice note whose owner turned typing off (MEDIA-17).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OTHER_MAX, clampForQuestion } from '../neon/functions/submit-response/answerShape.js';
import { resetFnDb, type newFnDbState } from './_fnDb.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const opts = (...values: string[]) => values.map((value) => ({ label: value, value }));

describe('choice answers (CH-16)', () => {
  const multi = (extra: Record<string, unknown> = {}) => ({
    type: 'multi_choice',
    options: opts('a', 'b', 'c'),
    ...extra,
  });

  it('a multi pick is capped at its max', () => {
    expect(clampForQuestion(multi({ max: 2 }), ['a', 'b', 'c'])).toEqual(['a', 'b']);
    // A fractional max reads the way the engine reads it: at most 2.
    expect(clampForQuestion(multi({ max: 2.5 }), ['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  it('dedupes and drops values that are not options when Other is off', () => {
    expect(clampForQuestion(multi(), ['a', 'zzz', 'a', 'a'])).toEqual(['a']);
    expect(clampForQuestion(multi(), [])).toEqual([]);
    expect(clampForQuestion(multi(), null)).toBeUndefined();
  });

  it('keeps one typed Other, capped, when the question allows it', () => {
    const q = multi({ allowOther: true, max: 3 });
    expect(clampForQuestion(q, ['a', 'x'.repeat(900), 'second typed', 'b'])).toEqual([
      'a',
      'x'.repeat(OTHER_MAX),
      'b',
    ]);
  });

  it('never traps: a max below the smallest number of picks is ignored', () => {
    // min 5 on three options is at most 3 picks; max 2 is below that, so it is ignored.
    expect(clampForQuestion(multi({ min: 5, max: 2 }), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    // With Other on there are four choices, so min 4 / max 3 also ignores the max.
    expect(
      clampForQuestion(multi({ allowOther: true, min: 4, max: 3 }), ['a', 'b', 'c', 'mine']),
    ).toEqual(['a', 'b', 'c', 'mine']);
    // A max of 0 (or below) is no limit.
    expect(clampForQuestion(multi({ max: 0 }), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('is lenient on min: a short list is stored, not refused', () => {
    expect(clampForQuestion(multi({ min: 2 }), ['a'])).toEqual(['a']);
  });

  it('single picks are one option value', () => {
    const single = { type: 'single_choice', options: opts('a', 'b') };
    expect(clampForQuestion(single, ['b', 'a'])).toBe('b');
    expect(clampForQuestion(single, 'zzz')).toBeUndefined();
    expect(clampForQuestion({ ...single, type: 'dropdown' }, 'a')).toBe('a');
    expect(clampForQuestion({ ...single, allowOther: true }, 'my own')).toBe('my own');
  });

  it('picture choice follows its multiple setting', () => {
    const pics = { type: 'picture_choice', options: opts('p1', 'p2', 'p3') };
    expect(clampForQuestion(pics, ['p2', 'p1'])).toBe('p2');
    expect(clampForQuestion({ ...pics, multiple: true, max: 2 }, ['p1', 'p2', 'p3'])).toEqual([
      'p1',
      'p2',
    ]);
  });
});

describe('matrix answers (GAP-14)', () => {
  const rows = Array.from({ length: 25 }, (_, i) => `r${i + 1}`);
  const grid = { type: 'matrix', rows: opts(...rows), columns: opts('good', 'bad') };

  it('keeps all 25 published rows (it kept the first 20)', () => {
    const answer = Object.fromEntries(rows.map((r) => [r, 'good']));
    expect(Object.keys(clampForQuestion(grid, answer) as object)).toHaveLength(25);
  });

  it('drops rows and columns the question doesn’t have', () => {
    expect(
      clampForQuestion(grid, { r1: 'good', r2: 'meh', nope: 'bad', toString: 'good' }),
    ).toEqual({ r1: 'good' });
    expect(clampForQuestion(grid, { r1: 'meh' })).toBeUndefined();
    expect(clampForQuestion(grid, ['good'])).toBeUndefined();
  });

  it('a matrix that takes several columns keeps a list per row', () => {
    const many = { ...grid, multiple: true };
    expect(clampForQuestion(many, { r1: ['good', 'bad', 'good', 'meh'], r2: 'bad' })).toEqual({
      r1: ['good', 'bad'],
      r2: ['bad'],
    });
    expect(clampForQuestion(grid, { r1: ['bad', 'good'] })).toEqual({ r1: 'bad' });
  });
});

describe('long text (GAP-14)', () => {
  it('keeps a 12,000-character answer whole (it was cut at 10,000)', () => {
    const long = 'x'.repeat(12_000);
    expect(clampForQuestion({ type: 'long_text' }, long)).toBe(long);
  });
});

describe('through the Function (GAP-14, CH-16)', () => {
  const FORM = 'f_clampqa00001';
  const rows = Array.from({ length: 25 }, (_, i) => `r${i + 1}`);
  const schema = {
    questions: [
      { id: 'story', type: 'long_text', title: 'Tell us' },
      { id: 'grid', type: 'matrix', title: 'Rate', rows: opts(...rows), columns: opts('y', 'n') },
      { id: 'pick', type: 'multi_choice', title: 'Pick', options: opts('a', 'b', 'c'), max: 2 },
    ],
  };
  let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
  const savedDb = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    app = (await import('../neon/functions/submit-response/index.js')).default;
  });

  afterAll(() => {
    if (savedDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDb;
  });

  beforeEach(() => {
    resetFnDb(db.state);
    db.state.forms.set(FORM, {
      id: FORM,
      name: 'Survey',
      published_name: 'Survey',
      slug: '51234567',
      status: 'published',
      deleted_at: null,
      owner_id: 'u_owner_clamp',
      fill_password_hash: null,
      published_schema: schema,
    } as never);
  });

  it('stores every row, the whole text, and at most max picks', async () => {
    const story = 'y'.repeat(12_000);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.21' },
      body: JSON.stringify({
        formId: FORM,
        answers: {
          story,
          grid: Object.fromEntries(rows.map((r) => [r, 'y'])),
          pick: ['a', 'b', 'c'],
        },
        meta: {
          startedAt: '2026-10-04T10:00:00.000Z',
          completedAt: '2026-10-04T10:01:00.000Z',
          durationMs: 60000,
          questionsVisited: ['story', 'grid', 'pick'],
          hiddenFields: {},
        },
      }),
    });
    expect(res.status).toBe(200);
    const stored = db.state.submissions[0]!.answers as Record<string, unknown>;
    expect(stored.story).toBe(story);
    expect(Object.keys(stored.grid as object)).toHaveLength(25);
    expect(stored.pick).toEqual(['a', 'b']);
  });
});
