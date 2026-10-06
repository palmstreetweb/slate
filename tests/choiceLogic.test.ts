/**
 * QA pass 2026-10-04, choice and logic (ADR-070): pick limits nobody is held
 * to past what they can give, the respondent's path, and answers in words on
 * Review and in piping.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { pickLimits, togglePick, validate } from '@/logic/validation.js';
import { pickHint } from '@/logic/pickRule.js';
import { pathOf, visibleAnswersForSubmit, visibleQuestions } from '@/logic/progress.js';
import { formatAnswerFor, pipe } from '@/logic/piping.js';
import { filesText, matrixText, reviewText } from '@/logic/reviewText.js';
import { useFormState } from '@/hooks/useFormState.js';
import { defineSchema } from '@/index.js';
import type { MultiChoiceQuestion, PictureChoiceQuestion, Question } from '@/types/Question.js';

const FOUR = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
  { label: 'C', value: 'c' },
  { label: 'D', value: 'd' },
];

const multi = (extra: Partial<MultiChoiceQuestion> = {}): MultiChoiceQuestion => ({
  id: 'm',
  type: 'multi_choice',
  title: 'Which?',
  options: FOUR,
  ...extra,
});

describe('pick limits a respondent can always meet (CH-04, GAP-09)', () => {
  it('a minimum above the choices asks for every choice instead', () => {
    expect(pickLimits(multi({ min: 6 }))).toEqual([4, Infinity]);
    expect(validate(multi({ min: 6 }), ['a', 'b', 'c', 'd'])).toBeNull();
    expect(validate(multi({ min: 6 }), ['a', 'b', 'c'])?.message).toBe('Pick at least 4');
    expect(pickLimits(multi({ min: 99_999_999_999 }))[0]).toBe(4);
  });

  it('Other counts as a choice', () => {
    expect(pickLimits(multi({ min: 6, allowOther: true }))[0]).toBe(5);
  });

  it('a maximum below the minimum is dropped, so min 3 / max 2 never traps anyone', () => {
    const q = multi({ min: 3, max: 2 });
    expect(pickLimits(q)).toEqual([3, Infinity]);
    expect(validate(q, ['a', 'b', 'c'])).toBeNull();
    expect(validate(q, ['a', 'b'])?.code).toBe('min_selections');
  });

  it('a maximum of 0 or below is dropped', () => {
    expect(validate(multi({ max: 0 }), [])).toBeNull();
    expect(validate(multi({ max: -1 }), [])).toBeNull();
    expect(validate(multi({ max: -1 }), ['a', 'b'])).toBeNull();
  });

  it('a negative minimum asks for nothing', () => {
    expect(validate(multi({ min: -3 }), [])).toBeNull();
  });

  it('decimals round to what a person can pick', () => {
    expect(pickLimits(multi({ min: 1.5, max: 2.5 }))).toEqual([2, 2]);
    expect(validate(multi({ min: 1.5 }), ['a'])?.message).toBe('Pick at least 2');
  });

  it('a real maximum still holds, in plain words', () => {
    expect(validate(multi({ max: 2 }), ['a', 'b', 'c'])).toEqual({
      code: 'max_selections',
      message: 'Pick up to 2',
    });
  });

  it('picture choice with several picks follows the same rules', () => {
    const q: PictureChoiceQuestion = {
      id: 'p',
      type: 'picture_choice',
      title: 'Which?',
      multiple: true,
      min: 5,
      max: 1,
      options: FOUR.slice(0, 2).map((o) => ({ ...o, src: `${o.value}.jpg` })),
    };
    expect(pickLimits(q)).toEqual([2, Infinity]);
    expect(validate(q, ['a', 'b'])).toBeNull();
    expect(validate(q, ['a'])?.message).toBe('Pick at least 2');
  });
});

describe('togglePick (CH-06: the maximum blocks extra picks)', () => {
  it('adds and removes', () => {
    expect(togglePick(multi(), undefined, 'a')).toEqual(['a']);
    expect(togglePick(multi(), ['a', 'b'], 'a')).toEqual(['b']);
  });

  it('refuses a pick past the maximum, but still lets one go', () => {
    const q = multi({ max: 2 });
    expect(togglePick(q, ['a', 'b'], 'c')).toEqual(['a', 'b']);
    expect(togglePick(q, ['a', 'b'], 'b')).toEqual(['a']);
  });

  it('ignores a maximum nobody could meet', () => {
    expect(togglePick(multi({ min: 3, max: 2 }), ['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });
});

describe('pickHint says the rule up front', () => {
  it.each([
    [{}, 'Pick as many as you like'],
    [{ max: 3 }, 'Pick up to 3'],
    [{ min: 2 }, 'Pick at least 2'],
    [{ min: 2, max: 3 }, 'Pick at least 2, up to 3'],
    [{ min: 2, max: 2 }, 'Pick 2'],
    [{ max: 9 }, 'Pick as many as you like'],
    [{ min: 3, max: 2 }, 'Pick at least 3'],
  ] as const)('%o → %s', (extra, text) => {
    expect(pickHint(multi(extra))).toBe(text);
  });

  it('speaks of likes on swipe cards', () => {
    expect(pickHint(multi({ max: 1 }), 'Like')).toBe('Like up to 1');
    expect(pickHint(multi({ min: 1, max: 3 }), 'Like')).toBe('Like at least 1, up to 3');
  });
});

/* ---------- the respondent's path (GAP-02, CH-14, GAP-24) ---------- */

const PETS = { field: 'pets', op: 'equals', value: 'yes' } as const;

const revealSchema = defineSchema({
  brand: { name: 'Test' },
  theme: 'editorial',
  themeMode: 'light',
  questions: [
    { id: 'intro', type: 'short_text', title: 'Name?' },
    {
      id: 'kinds',
      type: 'multi_choice',
      title: 'Which pets?',
      min: 1,
      options: [
        { label: 'Dog', value: 'dog' },
        { label: 'Cat', value: 'cat' },
      ],
      visibleIf: PETS,
    },
    {
      id: 'care',
      type: 'short_text',
      title: 'Who looks after them?',
      required: true,
      visibleIf: PETS,
    },
    { id: 'pets', type: 'yes_no', title: 'Any pets?' },
    { id: 'check', type: 'review', title: 'All good?' },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
});

describe('questions revealed by a later answer are asked (GAP-02)', () => {
  it('goes to each revealed question, then on to where the respondent was going', () => {
    const { result } = renderHook(() => useFormState(revealSchema));
    act(() => result.current.setAnswer('intro', 'Ada'));
    act(() => result.current.next()); // → pets
    expect(result.current.currentQuestion?.id).toBe('pets');
    act(() => result.current.setAnswer('pets', 'yes'));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('kinds');
    act(() => result.current.setAnswer('kinds', ['dog']));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('care');
    act(() => result.current.setAnswer('care', 'Me'));
    act(() => result.current.next());
    // Not back to "Any pets?": straight on to Review.
    expect(result.current.currentQuestion?.id).toBe('check');
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('done');
  });

  it('Back from a revealed question returns to the answer that revealed it', () => {
    const { result } = renderHook(() => useFormState(revealSchema));
    act(() => result.current.next()); // → pets
    act(() => result.current.setAnswer('pets', 'yes'));
    act(() => result.current.next()); // → kinds
    act(() => result.current.back());
    expect(result.current.currentQuestion?.id).toBe('pets');
  });

  it('questions a logic jump passes over are not asked later', () => {
    const schema = defineSchema({
      brand: { name: 'Test' },
      theme: 'editorial',
      themeMode: 'light',
      questions: [
        {
          id: 'biz',
          type: 'yes_no',
          title: 'A business?',
          logic: [{ if: { field: 'biz', op: 'equals', value: 'no' }, goTo: 'email' }],
        },
        { id: 'company', type: 'short_text', title: 'Company?', required: true },
        { id: 'size', type: 'short_text', title: 'Size?', required: true },
        { id: 'email', type: 'email', title: 'Email?' },
        { id: 'done', type: 'thanks', title: 'Thanks' },
      ],
    });
    const { result } = renderHook(() => useFormState(schema));
    act(() => result.current.setAnswer('biz', 'no'));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('email');
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('done');
  });
});

const jumpSchema = defineSchema({
  brand: { name: 'Test' },
  theme: 'editorial',
  themeMode: 'light',
  questions: [
    {
      id: 'path',
      type: 'single_choice',
      title: 'Which way?',
      options: [
        { label: 'Short', value: 'o1' },
        { label: 'Long', value: 'o2' },
      ],
      logic: [{ if: { field: 'path', op: 'equals', value: 'o1' }, goTo: 'check' }],
    },
    { id: 'detail', type: 'short_text', title: 'Tell us more' },
    { id: 'name', type: 'short_text', title: 'Name?' },
    { id: 'check', type: 'review', title: 'All good?' },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
});

describe('an edit from Review comes back to Review (CH-14, GAP-19)', () => {
  it('OK on the edited question returns to Review, not the next question', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.setAnswer('path', 'o2'));
    act(() => result.current.next()); // → detail
    act(() => result.current.setAnswer('detail', 'More'));
    act(() => result.current.next()); // → name
    act(() => result.current.setAnswer('name', 'Ada'));
    act(() => result.current.next()); // → check
    expect(result.current.currentQuestion?.id).toBe('check');
    act(() => result.current.goTo(1, 'backward')); // edit "Tell us more"
    expect(result.current.currentQuestion?.id).toBe('detail');
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('check');
  });

  it('an edit that puts a question on the path asks it first', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.setAnswer('path', 'o1'));
    act(() => result.current.next()); // jump → check
    expect(result.current.currentQuestion?.id).toBe('check');
    act(() => result.current.goTo(0, 'backward')); // edit "Which way?"
    act(() => result.current.setAnswer('path', 'o2'));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('detail');
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('name');
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('check');
  });

  it('a submit sending the respondent back (rewind) does not return to Review', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.setAnswer('path', 'o1'));
    act(() => result.current.next()); // → check
    act(() => result.current.next()); // → done
    act(() => result.current.goTo(0, 'backward', true));
    act(() => result.current.setAnswer('path', 'o1'));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('check');
  });
});

describe('answers off the path are left out (GAP-24)', () => {
  it('a branch abandoned from Review is not submitted', () => {
    const { result } = renderHook(() => useFormState(jumpSchema));
    act(() => result.current.setAnswer('path', 'o2'));
    act(() => result.current.next());
    act(() => result.current.setAnswer('detail', 'my detail'));
    expect(result.current.getSubmitAnswers()).toEqual({ path: 'o2', detail: 'my detail' });
    act(() => result.current.setAnswer('path', 'o1'));
    expect(result.current.getSubmitAnswers()).toEqual({ path: 'o1' });
    // Kept in state (ADR-005): taking the long way again brings it back.
    act(() => result.current.setAnswer('path', 'o2'));
    expect(result.current.getSubmitAnswers()).toEqual({ path: 'o2', detail: 'my detail' });
  });

  it('pathOf follows jumps and stops at the first ending', () => {
    const visible = visibleQuestions(jumpSchema.questions, { path: 'o1' });
    expect(pathOf(visible, { path: 'o1' }).map((i) => visible[i]!.id)).toEqual([
      'path',
      'check',
      'done',
    ]);
    expect(pathOf(visible, {}).map((i) => visible[i]!.id)).toEqual([
      'path',
      'detail',
      'name',
      'check',
      'done',
    ]);
  });

  it('a self jump moves on like the form does, instead of ending the path', () => {
    const questions: Question[] = [
      {
        id: 'a',
        type: 'short_text',
        title: 'A',
        logic: [{ if: { field: 'a', op: 'is_not_empty' }, goTo: 'a' }],
      },
      { id: 'b', type: 'short_text', title: 'B' },
    ];
    expect(visibleAnswersForSubmit(questions, { a: 'x', b: 'y' })).toEqual({ a: 'x', b: 'y' });
  });
});

/* ---------- answers in words (CH-13, MEDIA-04, MEDIA-14) ---------- */

describe('Review reads answers in words', () => {
  const grid: Question = {
    id: 'g',
    type: 'matrix',
    title: 'Rate us',
    multiple: true,
    rows: [
      { label: 'Speed', value: 'r1' },
      { label: 'Price', value: 'r2' },
      { label: 'Care', value: 'r3' },
    ],
    columns: [
      { label: 'Agree', value: 'c1' },
      { label: 'Disagree', value: 'c2' },
    ],
  };

  it('a grid by its row and column labels, rows with no pick left out', () => {
    expect(matrixText(grid.rows, grid.columns, { r1: ['c1'], r2: [], r3: ['c1', 'c2'] })).toBe(
      'Speed: Agree · Care: Agree, Disagree',
    );
    expect(reviewText(grid, { r1: [] }, formatAnswerFor)).toBe('');
    expect(reviewText(grid, { r2: 'c2' }, formatAnswerFor)).toBe('Price: Disagree');
  });

  it('files by name, or a count when a stored file has no name', () => {
    expect(
      filesText([
        'slate-file://storage:public/f_1/1b2c/photo%20one.jpg',
        'https://cdn.example.com/u/notes.pdf?sig=1',
      ]),
    ).toBe('photo one.jpg, notes.pdf');
    expect(filesText(['slate-file://97118808-7543', 'slate-file://b5589b02'])).toBe('2 files');
    expect(filesText('slate-file://97118808-7543')).toBe('1 file');
    expect(filesText(new File(['x'], 'a.txt'))).toBe('a.txt');
  });

  it('sign-up slots by name or day and 12-hour time', () => {
    const slots: Question = {
      id: 's',
      type: 'signup_slots',
      title: 'When?',
      slots: [
        { value: 'a', label: '', capacity: 2, date: '2026-10-10', start: '09:00', end: '10:00' },
        { value: 'b', label: 'Ice', capacity: 2 },
      ],
    };
    expect(reviewText(slots, { slots: ['a'], wait: ['b'] }, formatAnswerFor)).toBe(
      'Sat, Oct 10 · 9–10 AM, Ice (waitlist)',
    );
  });

  it('availability in 12-hour ranges', () => {
    const week: Question = { id: 'w', type: 'availability', title: 'Free?', days: ['mon'] };
    expect(reviewText(week, { mon: '09:00-10:00' }, formatAnswerFor)).toBe('Mon 9–10 AM');
  });
});

describe('piping never shows a stored file ref (MEDIA-04)', () => {
  const files: Question = { id: 'f', type: 'file_upload', title: 'Files' };

  it('names files from the cloud, and counts local ones, which carry no name', () => {
    expect(formatAnswerFor(files, ['slate-file://storage:public/f_1/1b2c/photo.jpg'])).toBe(
      'photo.jpg',
    );
    expect(formatAnswerFor(files, 'slate-file://97118808')).toBe('1 file');
    // Never "Uploaded file, Uploaded file and Uploaded file" (MEDIA-04 retest).
    expect(
      pipe(
        'You sent {{field:f}}',
        { f: ['slate-file://1', 'slate-file://2', 'slate-file://3'] },
        0,
        [files],
      ),
    ).toBe('You sent 3 files');
    expect(
      pipe('You sent {{field:f}}', { f: ['slate-file://storage:public/f/u/a.pdf'] }, 0, [files]),
    ).toBe('You sent a.pdf');
  });
});
