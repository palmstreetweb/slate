// @vitest-environment node
/**
 * The submit Function computes `meta.score` itself (audit 2026-10, ADR-071):
 * a respondent's `meta.score` is dropped, and the stored figure is the sum of
 * the PUBLISHED option scores for the answers kept — the same sum the engine's
 * `computeScore` shows during the fill.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeScore } from '@/logic/scoring.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { computeScoreCore } from '../neon/functions/submit-response/scoring.js';
import { resetFnDb, type newFnDbState } from './_fnDb.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));
vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

type App = { request: (path: string, init: RequestInit) => Response | Promise<Response> };
let app: App;
const savedDb = process.env.DATABASE_URL;

const FORM = 'f_score001';
const schema = {
  brand: { name: 'Quiz' },
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    {
      id: 'capital',
      type: 'single_choice',
      title: 'Capital of France?',
      options: [
        { label: 'Paris', value: 'paris', score: 5 },
        { label: 'Lyon', value: 'lyon', score: 0 },
      ],
    },
    {
      id: 'primes',
      type: 'multi_choice',
      title: 'Primes?',
      options: [
        { label: '2', value: 'two', score: 2 },
        { label: '3', value: 'three', score: 2 },
        { label: '4', value: 'four', score: -1 },
      ],
    },
    { id: 'n', type: 'number', title: 'How many?' },
  ],
};

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  app = (await import('../neon/functions/submit-response/index.js')).default as App;
});
afterAll(() => {
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
});
beforeEach(() => {
  resetFnDb(db.state);
  db.state.forms.set(FORM, {
    id: FORM,
    name: 'Quiz',
    slug: 'quiz-night',
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner_q',
    fill_password_hash: null,
    published_schema: schema,
  });
});

const submit = (answers: Record<string, unknown>, score: unknown) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' },
    body: JSON.stringify({
      formId: FORM,
      answers,
      meta: {
        startedAt: '2026-10-09T10:00:00.000Z',
        completedAt: '2026-10-09T10:01:00.000Z',
        durationMs: 60000,
        questionsVisited: ['capital'],
        hiddenFields: {},
        score,
      },
    }),
  });

const storedMeta = () => db.state.submissions[0]!.meta as { score?: unknown };

describe('submit: the score is the server’s own sum', () => {
  it('a forged meta.score is replaced by the published option scores of the answers kept', async () => {
    const res = await submit({ capital: 'paris', primes: ['two', 'three'], name: 'Ada' }, 1e308);
    expect(res.status).toBe(200);
    expect(storedMeta().score).toBe(9);
  });

  it('wrong answers, unknown options and non-choice questions add nothing', async () => {
    await submit({ capital: 'lyon', primes: ['four', 'nope'], n: 42 }, 99);
    expect(storedMeta().score).toBe(-1);
  });

  it('a form with no scored options stores 0, whatever the browser said', async () => {
    db.state.forms.get(FORM)!.published_schema = {
      brand: { name: 'Plain' },
      questions: [{ id: 'name', type: 'short_text', title: 'Name' }],
    };
    await submit({ name: 'Ada' }, 7);
    expect(storedMeta().score).toBe(0);
  });
});

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('computeScoreCore agrees with the engine’s computeScore', () => {
  it('on 500 random schemas and answers, including junk the engine never sends', () => {
    const r = rng(22);
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
    for (let n = 0; n < 500; n++) {
      const questions: Record<string, unknown>[] = [];
      const answers: Record<string, unknown> = {};
      const count = 1 + Math.floor(r() * 6);
      for (let i = 0; i < count; i++) {
        const id = `q${i}`;
        const type = pick([
          'single_choice',
          'multi_choice',
          'dropdown',
          'picture_choice',
          'short_text',
          'number',
        ]);
        const options = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => {
          const score = pick([0, 1, 2.5, -3, 100, undefined]);
          return { label: `O${k}`, value: `v${k}`, ...(score === undefined ? {} : { score }) };
        });
        questions.push({ id, type, title: id, options });
        answers[id] = pick([
          'v0',
          'v1',
          'v9',
          ['v0', 'v1'],
          ['v1', 'v1'],
          ['v2', 'zzz'],
          7,
          undefined,
          null,
          { v: 'v0' },
        ]);
      }
      const engine = computeScore(questions as unknown as Question[], answers as LooseAnswers);
      const server = computeScoreCore({ questions }, answers);
      expect(server, JSON.stringify({ questions, answers })).toBe(engine);
    }
  });

  it('is 0 for junk schemas and never NaN or infinite', () => {
    expect(computeScoreCore(null, {})).toBe(0);
    expect(computeScoreCore({ questions: 'x' }, {})).toBe(0);
    expect(
      computeScoreCore(
        {
          questions: [{ id: 'a', type: 'single_choice', options: [{ value: 'x', score: 1e308 }] }],
        },
        { a: 'x' },
      ),
    ).toBe(1e308);
    expect(
      computeScoreCore(
        {
          questions: [
            { id: 'a', type: 'multi_choice', options: [{ value: 'x', score: Number.NaN }] },
          ],
        },
        { a: ['x'] },
      ),
    ).toBe(0);
  });
});
