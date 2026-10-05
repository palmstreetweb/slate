/** @vitest-environment node */
/**
 * QA pass (w4a): the submit Function keeps choice answers inside the published
 * rules with the engine's own clamp (CH-16), keeps every published matrix row
 * and every character the page accepted (GAP-14), and keeps typed text on a
 * voice note whose owner turned typing off (MEDIA-17).
 * Review fixes: a value the published question no longer lists — an option,
 * row or column the owner removed while someone was answering — is kept as
 * text like a typed Other, never dropped in silence (SRV-1), and a grid keeps
 * every published row, past 100 too (SRV-2).
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

  // SRV-1 changed this on purpose: 'zzz' was dropped. A value the question
  // doesn't list is what a page loaded before the owner removed that option
  // sends, so it is kept as text, once, like a typed Other.
  it('dedupes, and keeps a value that is not an option as text when Other is off', () => {
    expect(clampForQuestion(multi(), ['a', 'zzz', 'a', 'a'])).toEqual(['a', 'zzz']);
    expect(clampForQuestion(multi(), [])).toEqual([]);
    expect(clampForQuestion(multi(), null)).toBeUndefined();
  });

  it('keeps such text bounded: cut at 500 characters, once, never blank or nested', () => {
    expect(
      clampForQuestion(multi(), ['q'.repeat(900), 'q'.repeat(700), '  ', '', { a: 1 }, ['b'], 'b']),
    ).toEqual(['q'.repeat(OTHER_MAX), 'b']);
    // A list longer than the engine could send is read up to 100 entries.
    const many = Array.from({ length: 150 }, (_, i) => `gone_${i}`);
    expect(clampForQuestion(multi(), many)).toHaveLength(100);
  });

  it('keeps the typed Other, capped, when the question allows it', () => {
    const q = multi({ allowOther: true, max: 3 });
    expect(clampForQuestion(q, ['a', 'x'.repeat(900), 'b'])).toEqual([
      'a',
      'x'.repeat(OTHER_MAX),
      'b',
    ]);
  });

  // SRV-1: with Other on, an option removed since the page loaded used to take
  // the one typed slot, and the respondent's own words were dropped.
  it('keeps a removed option and the typed Other together', () => {
    const q = multi({ allowOther: true });
    expect(clampForQuestion(q, ['a', 'opt_gone01', 'my own words'])).toEqual([
      'a',
      'opt_gone01',
      'my own words',
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

  it('single picks are one value', () => {
    const single = { type: 'single_choice', options: opts('a', 'b') };
    expect(clampForQuestion(single, ['b', 'a'])).toBe('b');
    // SRV-1 (was dropped): an option removed while the respondent was answering.
    expect(clampForQuestion(single, 'zzz')).toBe('zzz');
    expect(clampForQuestion(single, '   ')).toBeUndefined();
    expect(clampForQuestion(single, { value: 'a' })).toBeUndefined();
    expect(clampForQuestion({ ...single, type: 'dropdown' }, 'a')).toBe('a');
    expect(clampForQuestion({ ...single, allowOther: true }, 'my own')).toBe('my own');
  });

  it('a pick the owner removed and republished during the fill is kept (SRV-1)', () => {
    const when = { type: 'single_choice', required: true, options: opts('sat_11', 'sun_10') };
    expect(clampForQuestion(when, 'sat_10')).toBe('sat_10');
    const extras = { type: 'multi_choice', options: opts('edging', 'repairs'), max: 3 };
    expect(clampForQuestion(extras, ['edging', 'stripes', 'repairs'])).toEqual([
      'edging',
      'stripes',
      'repairs',
    ]);
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

  // SRV-1 changed this on purpose: rows and columns the question no longer
  // lists were dropped. A page loaded before the owner removed them sends them,
  // so they are kept as text; unsafe keys and nested values still never are.
  it('keeps a row or column removed since the page loaded, as text', () => {
    expect(
      clampForQuestion(grid, { r1: 'good', r2: 'meh', nope: 'bad', toString: 'good' }),
    ).toEqual({ r1: 'good', r2: 'meh', nope: 'bad' });
    expect(clampForQuestion(grid, { r1: 'meh' })).toEqual({ r1: 'meh' });
    expect(clampForQuestion(grid, ['good'])).toBeUndefined();
  });

  it('bounds what it keeps for rows the question doesn’t list', () => {
    const answer = JSON.parse(
      `{"__proto__": "good", "r1": "good", "${'k'.repeat(65)}": "good", "${'k'.repeat(64)}": "bad",` +
        ` "blank": "  ", "nested": {"a": "good"}, "empty": [], "long": "${'v'.repeat(900)}"}`,
    ) as Record<string, unknown>;
    expect(clampForQuestion(grid, answer)).toEqual({
      r1: 'good',
      ['k'.repeat(64)]: 'bad',
      long: 'v'.repeat(OTHER_MAX),
    });
    expect(Object.prototype.hasOwnProperty.call(clampForQuestion(grid, answer), '__proto__')).toBe(
      false,
    );
    // At most 100 rows the question doesn't list, after every published one.
    const stale = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`old${i}`, 'good']));
    const kept = clampForQuestion(grid, { ...stale, r25: 'bad' }) as Record<string, unknown>;
    expect(Object.keys(kept)).toHaveLength(101);
    expect(kept.r25).toBe('bad');
    expect(kept.old99).toBe('good');
    expect(kept.old100).toBeUndefined();
  });

  it('a matrix that takes several columns keeps a list per row', () => {
    const many = { ...grid, multiple: true };
    expect(clampForQuestion(many, { r1: ['good', 'bad', 'good', 'meh'], r2: 'bad' })).toEqual({
      r1: ['good', 'bad', 'meh'],
      r2: ['bad'],
    });
    expect(clampForQuestion(grid, { r1: ['bad', 'good'] })).toEqual({ r1: 'bad' });
  });

  it('keeps every published row past 100 (SRV-2: it kept the first 100)', () => {
    const wide = Array.from({ length: 120 }, (_, i) => `item_${i + 1}`);
    const q = { type: 'matrix', rows: opts(...wide), columns: opts('have', 'need') };
    const answer = Object.fromEntries(wide.map((r) => [r, 'need']));
    const kept = clampForQuestion(q, answer) as Record<string, unknown>;
    expect(Object.keys(kept)).toHaveLength(120);
    expect(kept.item_120).toBe('need');
  });
});

describe('long text (GAP-14)', () => {
  it('keeps a 12,000-character answer whole (it was cut at 10,000)', () => {
    const long = 'x'.repeat(12_000);
    expect(clampForQuestion({ type: 'long_text' }, long)).toBe(long);
  });
});

describe('through the Function (GAP-14, CH-16, SRV-1, SRV-2)', () => {
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

  /** Publish `questions` on the test form, then send `answers` as a page would. */
  async function sendTo(questions: unknown[], answers: Record<string, unknown>) {
    db.state.forms.get(FORM)!.published_schema = { questions };
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.22' },
      body: JSON.stringify({
        formId: FORM,
        answers,
        meta: {
          startedAt: '2026-10-05T10:00:00.000Z',
          completedAt: '2026-10-05T10:01:00.000Z',
          durationMs: 60000,
          questionsVisited: Object.keys(answers),
          hiddenFields: {},
        },
      }),
    });
    expect(res.status).toBe(200);
    return db.state.submissions[0]!.answers as Record<string, unknown>;
  }

  it('keeps a required pick the owner removed and republished mid-fill (SRV-1)', async () => {
    // The page loaded with Sat 10am; the owner then removed it and republished.
    const stored = await sendTo(
      [
        { id: 'name', type: 'short_text', title: 'Name' },
        {
          id: 'when',
          type: 'single_choice',
          title: 'When?',
          required: true,
          options: opts('sat_11', 'sun_10'),
        },
        {
          id: 'grid',
          type: 'matrix',
          title: 'Rate',
          rows: opts('r1', 'r2'),
          columns: opts('y', 'n'),
        },
      ],
      { name: 'Ana', when: 'sat_10', grid: { r1: 'maybe', r2: 'y', r_old: 'n' } },
    );
    expect(stored).toEqual({
      name: 'Ana',
      when: 'sat_10',
      grid: { r1: 'maybe', r2: 'y', r_old: 'n' },
    });
  });

  it('stores all 120 rows of a 120-row grid (SRV-2: it kept 100)', async () => {
    const wide = Array.from({ length: 120 }, (_, i) => `item_${i + 1}`);
    const stored = await sendTo(
      [
        {
          id: 'stock',
          type: 'matrix',
          title: 'Stock',
          required: true,
          rows: opts(...wide),
          columns: opts('have', 'need'),
        },
      ],
      { stock: Object.fromEntries(wide.map((r, i) => [r, i % 2 ? 'have' : 'need'])) },
    );
    const grid = stored.stock as Record<string, unknown>;
    expect(Object.keys(grid)).toHaveLength(120);
    expect(grid.item_101).toBe('need');
    expect(grid.item_120).toBe('have');
  });
});
