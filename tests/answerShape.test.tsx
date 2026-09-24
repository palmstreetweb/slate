import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../src/index.js';
import { clampValue } from '../neon/functions/submit-response/answerShape.ts';
import { normalizeAnswers, normalizeMeta, safeText } from '../examples/_admin/answerShape.js';
import { rowToSubmission } from '../examples/_admin/neon/mappers.js';
import {
  formatAnswerForCsv,
  formatAnswerForQuestion,
  leadPreview,
} from '../examples/_admin/responsesFormat.js';
import { ErrorBoundary, PageCrashFallback } from '../examples/_admin/components/ErrorBoundary.js';
import type { DbSubmissionRow } from '../examples/_admin/neon/database.types.js';

// The audit H1 payload: `String()` on this throws "Cannot convert object to primitive value".
const hostile = () => JSON.parse('{"toString": 1, "valueOf": 1}') as unknown;
const protoKey = () => JSON.parse('{"__proto__": {"polluted": "yes"}, "row1": "col1"}') as unknown;

const QUESTION_TYPES: Question['type'][] = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'date',
  'file_upload',
  'scale',
  'nps',
  'single_choice',
  'multi_choice',
  'dropdown',
  'picture_choice',
  'ranking',
  'matrix',
  'yes_no',
  'legal',
] as Question['type'][];

function question(type: Question['type']): Question {
  return {
    id: 'q1',
    type,
    title: 'Q',
    options: [{ value: 'a', label: 'A' }],
    rows: [{ value: 'row1', label: 'Row 1' }],
    columns: [{ value: 'col1', label: 'Col 1' }],
  } as unknown as Question;
}

const HOSTILE_VALUES: unknown[] = [
  hostile(),
  [hostile()],
  [[hostile()]],
  { row1: hostile() },
  { row1: [hostile()] },
  protoKey(),
  Object.create(null),
  Symbol('x'),
  () => 1,
  NaN,
  Infinity,
  10n,
];

describe('submit Function clamps answers to renderable shapes', () => {
  it('drops the audit payload inside arrays and objects', () => {
    expect(clampValue([hostile()])).toEqual([]);
    expect(clampValue(hostile())).toEqual({});
    expect(clampValue({ row1: hostile(), row2: 'b' })).toEqual({ row2: 'b' });
  });

  it('keeps every legitimate answer shape', () => {
    expect(clampValue('hi')).toBe('hi');
    expect(clampValue(7)).toBe(7);
    expect(clampValue(true)).toBe(true);
    expect(clampValue(['a', 'b'])).toEqual(['a', 'b']);
    expect(clampValue({ row1: 'col1', row2: ['c1', 'c2'] })).toEqual({
      row1: 'col1',
      row2: ['c1', 'c2'],
    });
  });

  it('turns scalar list items into text and drops nested containers', () => {
    expect(clampValue([1, true, 'x', ['nested'], { a: 1 }, null])).toEqual(['1', 'true', 'x']);
  });

  it('never keeps keys that shadow Object.prototype', () => {
    const out = clampValue(protoKey()) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['row1']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('drops null and non-finite numbers', () => {
    expect(clampValue(null)).toBeUndefined();
    expect(clampValue(Number.NaN)).toBeUndefined();
  });

  it('clamps long strings', () => {
    expect((clampValue('x'.repeat(20_000)) as string).length).toBe(10_000);
  });
});

describe('studio normalizes every stored row on load', () => {
  it('keeps legitimate answers untouched', () => {
    const answers = {
      name: 'Nora',
      age: 32,
      picks: ['a', 'b'],
      grid: { row1: 'col1', row2: ['c1', 'c2'] },
    };
    expect(normalizeAnswers(answers)).toEqual(answers);
  });

  it('strips hostile values instead of passing them to render', () => {
    const out = normalizeAnswers({
      q1: [hostile()],
      q2: hostile(),
      q3: { row1: hostile(), row2: 'ok' },
      q4: null,
      toString: 'shadow',
    });
    expect(out).toEqual({ q1: [], q2: {}, q3: { row2: 'ok' } });
    expect(() => String(out.q2)).not.toThrow();
  });

  it('survives junk at the top level', () => {
    for (const junk of [null, 'str', 42, [1, 2], hostile()]) {
      expect(() => normalizeAnswers(junk)).not.toThrow();
    }
  });

  it('normalizes meta', () => {
    expect(normalizeMeta({ durationMs: 'x', hiddenFields: { a: hostile(), b: 2 } })).toEqual({
      startedAt: '',
      completedAt: '',
      durationMs: 0,
      questionsVisited: [],
      hiddenFields: { b: '2' },
      score: 0,
    });
    expect(() => normalizeMeta(null)).not.toThrow();
  });

  it('rowToSubmission + leadPreview no longer throw on the audit row (H1)', () => {
    const row = {
      id: 's1',
      form_id: 'f1',
      received_at: '2026-09-23T10:00:00Z',
      answers: { q1: [hostile()], q2: hostile() },
      meta: { durationMs: 1000 },
      deleted_at: null,
    } as unknown as DbSubmissionRow;
    const sub = rowToSubmission(row);
    const questions = [
      { ...question('multi_choice'), id: 'q1' },
      { ...question('short_text'), id: 'q2' },
    ] as Question[];
    expect(() => leadPreview(questions, sub.answers as Record<string, unknown>)).not.toThrow();
  });
});

describe('answer formatter is total', () => {
  it.each(QUESTION_TYPES)('%s never throws on hostile values', (type) => {
    const q = question(type);
    for (const value of HOSTILE_VALUES) {
      expect(() => formatAnswerForQuestion(q, value)).not.toThrow();
      expect(typeof formatAnswerForQuestion(q, value)).toBe('string');
      expect(() => formatAnswerForCsv(q, value)).not.toThrow();
    }
  });

  it('still formats normal answers', () => {
    expect(formatAnswerForQuestion(question('single_choice'), 'a')).toBe('A');
    expect(formatAnswerForQuestion(question('multi_choice'), ['a', 'z'])).toBe('A, z');
    expect(formatAnswerForQuestion(question('matrix'), { row1: 'col1' })).toBe('Row 1: Col 1');
    expect(formatAnswerForQuestion(question('number'), 5)).toBe('5');
    expect(formatAnswerForQuestion(question('short_text'), '')).toBe('—');
  });

  it('safeText handles anything', () => {
    expect(safeText(hostile())).toBe('{"toString":1,"valueOf":1}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(safeText(cyclic)).toBe('');
    expect(safeText([1, 'a', null])).toBe('1, a, ');
  });
});

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  function Boom(): never {
    throw new Error('Cannot convert object to primitive value');
  }

  it('contains a crash and keeps siblings mounted', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <ErrorBoundary label="notifications" fallback={null}>
          <Boom />
        </ErrorBoundary>
        <p>Your forms</p>
      </div>,
    );
    expect(screen.getByText('Your forms')).toBeTruthy();
  });

  it('page fallback offers a way out, and clears on navigation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = (key: string, crash: boolean) => (
      <ErrorBoundary
        label="page"
        resetKey={key}
        fallback={(reset) => <PageCrashFallback onRetry={reset} />}
      >
        {crash ? <Boom /> : <p>Dashboard</p>}
      </ErrorBoundary>
    );
    const { rerender } = render(view('/forms/a', true));
    expect(screen.getByRole('alert').textContent).toContain('This page hit a problem.');
    expect(screen.getByText('Your forms').getAttribute('href')).toBe('/');
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(view('/', false));
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('logs the message only, never the component props', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary label="notifications" fallback={null}>
        <Boom />
      </ErrorBoundary>,
    );
    const ours = spy.mock.calls.find((c) => String(c[0]).startsWith('[slate]'));
    expect(ours?.[0]).toBe(
      '[slate] notifications crashed: Cannot convert object to primitive value',
    );
  });
});
