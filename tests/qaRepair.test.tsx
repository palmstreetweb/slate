/**
 * QA repair pass (2026-10-05): what the retest of the QA fixes still found on
 * the respondent's side — a pattern from JSON that crashed Enter, limits read
 * the way people write them, prefilled "1,000" and "10/20/2026", Review titles
 * with their piping resolved, a reload after a submit that sent it twice, a
 * double or held Enter skipping one-tap questions, a swipe decided after Back,
 * repeated option values, and the reasons a refused pick gives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { charCount, pickLimits, textMax, validate } from '@/logic/validation.js';
import { pickHint } from '@/logic/pickRule.js';
import { prefillAnswers } from '@/logic/prefill.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext, FormOtherRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import { focusAfter } from '@/utils/focus.js';
import { acceptTokens, matchesAccept } from '@/components/questions/FileUploadField.js';
import { NOT_A_PHOTO, SLATE_IMAGE_TYPE_HINT } from '@/utils/imageFileTypes.js';
import { normalizePickedImageFile } from '@/utils/heicToJpeg.js';
import { prepareImageForStorage } from '@/utils/prepareImageForStorage.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import {
  uniqueByValue,
  withoutRepeatedOptions,
  withoutRepeatedOptionsIn,
} from '../examples/_admin/uniqueOptions.js';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** QuestionRenderer with its answers kept, its OK on Enter, like <Form> runs it. */
function Live({
  question,
  initial = {},
  advance,
  onSet,
}: {
  question: Question;
  initial?: LooseAnswers;
  advance: () => void;
  onSet?: (id: string, v: unknown) => void;
}) {
  const [answers, setAnswers] = useState<LooseAnswers>(initial);
  const confirmRef = useRef<(() => void) | null>(null);
  const otherRef = useRef<(() => void) | null>(null);
  useKeyboardNav({
    currentQ: question,
    onAdvance: advance,
    onBack: vi.fn(),
    onConfirm: () => {
      if (!confirmRef.current) return false;
      confirmRef.current();
      return true;
    },
  });
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
      <FormOtherRefContext.Provider value={otherRef}>
        <div data-slate-forms="" data-theme-name="classic" data-theme="light">
          <div className="slate-stage-content">
            <QuestionRenderer
              question={question}
              answers={answers}
              setAnswer={(id, v) => {
                onSet?.(id, v);
                setAnswers(
                  (cur) =>
                    ({
                      ...cur,
                      [id]: typeof v === 'function' ? (v as (p: unknown) => unknown)(cur[id]) : v,
                    }) as LooseAnswers,
                );
              }}
              advance={advance}
              stepNumber={1}
              totalSteps={2}
              submitStatus="idle"
              submitError={null}
              onRetrySubmit={vi.fn()}
              onRestart={vi.fn()}
              allQuestions={[question]}
            />
          </div>
        </div>
      </FormOtherRefContext.Provider>
    </FormConfirmRefContext.Provider>
  );
}

function renderLive(question: Question, initial: LooseAnswers = {}) {
  const advance = vi.fn();
  const onSet = vi.fn();
  const utils = render(
    <Live question={question} initial={initial} advance={advance} onSet={onSet} />,
  );
  return { ...utils, advance, onSet };
}

/* ---------- typed text ---------- */

describe('a short text pattern that came through JSON (NEW-01)', () => {
  const q = (pattern: unknown) =>
    ({ id: 'code', type: 'short_text', title: 'Code?', pattern }) as unknown as Question;

  it('a string or {} pattern is ignored instead of throwing', () => {
    expect(() => validate(q('^[A-Z]{3}$'), 'abc')).not.toThrow();
    expect(validate(q('^[A-Z]{3}$'), 'abc')).toBeNull();
    expect(validate(q({}), 'abc')).toBeNull();
    expect(validate(q({ test: 'nope' }), 'abc')).toBeNull();
  });

  it('a real RegExp still checks the format', () => {
    expect(validate(q(/^[A-Z]{3}$/), 'abc')?.code).toBe('pattern');
    expect(validate(q(/^[A-Z]{3}$/), 'ABC')).toBeNull();
  });

  it('a portable link drops the pattern before the form renders', () => {
    const out = sanitizeUntrustedSchema({
      brand: { name: 'B' },
      theme: 'classic',
      questions: [q('^[A-Z]{3}$'), { id: 'done', type: 'thanks', title: 'T' }],
    } as never);
    expect(out.questions[0]).not.toHaveProperty('pattern');
  });

  it('Enter on such a question moves on with the answer', async () => {
    const { advance, onSet } = renderLive(q('^[A-Z]{3}$'));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: 'abc' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSet).toHaveBeenCalledWith('code', 'abc');
    expect(advance).toHaveBeenCalled();
  });
});

describe('max length in whole characters, said as people say it (R18, R26)', () => {
  const text = (maxLength: number) =>
    ({ id: 't', type: 'short_text', title: 'T', maxLength }) as Question;

  it('a decimal limit is a whole one; 0 or less is no limit', () => {
    expect(textMax({ maxLength: 2.5 })).toBe(2);
    expect(textMax({ maxLength: 0 })).toBe(10000);
    expect(textMax({ maxLength: -5 })).toBe(10000);
    expect(validate(text(2.5), 'Hi there')?.message).toBe('Keep it to 2 characters or fewer');
  });

  it('one character, not "1 characters"; 10,000 with its comma', () => {
    expect(validate(text(1), 'ab')?.message).toBe('Keep it to 1 character or fewer');
    expect(validate({ id: 't', type: 'long_text', title: 'T' }, 'x'.repeat(10001))?.message).toBe(
      'Keep it to 10,000 characters or fewer',
    );
  });

  it('an emoji counts as one character, in the check and in the counter', async () => {
    expect(charCount('👍👍👍')).toBe(3);
    expect(validate(text(3), '👍👍👍')).toBeNull();
    renderLive(text(3));
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '👍👍👍' } });
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('a typed box says "next" on a phone keyboard; a long answer’s Return makes a new line', async () => {
    renderLive(text(10));
    expect(await screen.findByRole('textbox')).toHaveAttribute('enterkeyhint', 'next');
  });
});

describe('number limits in words (copy QA)', () => {
  const num = (extra: Record<string, unknown>) =>
    ({ id: 'n', type: 'number', title: 'N', ...extra }) as unknown as Question;

  it('thousands get their commas, and a single allowed value reads as itself', () => {
    expect(validate(num({ min: 1000, max: 1000000, prefix: '$' }), 5)?.message).toBe(
      'Enter a number from $1,000 to $1,000,000',
    );
    expect(validate(num({ min: 0, max: 0 }), 3)?.message).toBe('Enter 0');
    expect(validate(num({ min: 0.25 }), 0)?.message).toBe('Enter 0.25 or more');
  });
});

/* ---------- prefill ---------- */

describe('prefill reads numbers and dates as they are typed (GAP-23)', () => {
  const questions: Question[] = [
    { id: 'budget', type: 'number', title: 'Budget?', prefillKey: 'budget' } as Question,
    { id: 'day', type: 'date', title: 'Day?', prefillKey: 'day' } as Question,
    {
      id: 'dmy',
      type: 'date',
      title: 'Day?',
      format: 'DD/MM/YYYY',
      prefillKey: 'dmy',
    } as Question,
  ];

  it('"1,000" and "$1,500" are numbers', () => {
    expect(prefillAnswers(questions, { budget: '1,000' })).toEqual({ budget: 1000 });
    expect(prefillAnswers(questions, { budget: '$1,500' })).toEqual({ budget: 1500 });
    expect(prefillAnswers(questions, { budget: '1,000,000.5' })).toEqual({ budget: 1000000.5 });
    // Not a number a person would mean: still ignored.
    expect(prefillAnswers(questions, { budget: '1,5' })).toEqual({});
  });

  it('"10/20/2026" in the form’s order; "26" is 2026; ISO still works', () => {
    expect(prefillAnswers(questions, { day: '10/20/2026' })).toEqual({ day: '2026-10-20' });
    expect(prefillAnswers(questions, { day: '3-7-26' })).toEqual({ day: '2026-03-07' });
    expect(prefillAnswers(questions, { dmy: '20.10.26' })).toEqual({ dmy: '2026-10-20' });
    // The same sliding window as the boxes: a birth year in the last century.
    expect(prefillAnswers(questions, { day: '4/12/85' })).toEqual({ day: '1985-04-12' });
    expect(prefillAnswers(questions, { day: '2026-10-20' })).toEqual({ day: '2026-10-20' });
    // An impossible date is ignored, never stored.
    expect(prefillAnswers(questions, { day: '13/40/2026' })).toEqual({});
  });
});

/* ---------- Review ---------- */

describe('Review lists titles as the questions showed them (copy QA)', () => {
  it('"Your email, {{field:name}}?" reads "Your email, Ana?"', async () => {
    const user = userEvent.setup();
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'B' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            { id: 'name', type: 'short_text', title: 'Your name?' },
            { id: 'email', type: 'email', title: 'Your email, {{field:name}}?' },
            { id: 'review', type: 'review', title: 'Check your answers' },
            { id: 'done', type: 'thanks', title: 'Thanks' },
          ],
        })}
        onSubmit={vi.fn()}
      />,
    );
    await user.type(await screen.findByRole('textbox'), 'Ana{Enter}');
    await user.type(
      await screen.findByRole('textbox', { name: 'Your email, Ana?' }),
      'a@b.co{Enter}',
    );
    await screen.findByText('Check your answers');
    expect(await screen.findByText('Your email, Ana?')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{field:name\}\}/)).toBeNull();
  });
});

/* ---------- resume after a submit (R12) ---------- */

describe('a reload after the submit never offers to resume onto it (R12)', () => {
  const KEY = 'slate-forms-resume:sync';
  const schema = () =>
    defineSchema({
      id: 'sync',
      brand: { name: 'B' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { id: 'hi', type: 'welcome', title: 'Hello', cta: 'Start' },
        { id: 'name', type: 'short_text', title: 'Your name?' },
        { id: 'done', type: 'thanks', title: 'Done!' },
      ],
    });

  beforeEach(() => window.sessionStorage.clear());

  it('a synchronous submit (the portable link’s) leaves nothing saved', async () => {
    // What the tab holds while the answers are sent. In a browser a save made
    // as the ending appears can land after a synchronous submit has cleared it
    // (the visited list re-renders in a later task), so the ending itself must
    // never be saved: by then only the question before it is.
    let heldAtSubmit: { step: number } | null = null;
    const onSubmit = vi.fn(() => {
      heldAtSubmit = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null');
    }); // returns at once, like PublicRespond's local save
    const user = userEvent.setup();
    const first = render(<Form schema={schema()} resume="tab" onSubmit={onSubmit} />);
    await user.click(await screen.findByRole('button', { name: /start/i }));
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await screen.findByText('Done!');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(heldAtSubmit).toMatchObject({ step: 1 });
    // Let every effect after the submit run (the visited list updates after the step).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    first.unmount();
    render(<Form schema={schema()} resume="tab" onSubmit={onSubmit} />);
    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('a save left on the ending by an older page resumes on the question before it', async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        answers: { name: 'Ada' },
        step: 2,
        visitedIds: ['hi', 'name', 'done'],
        // A save with a time the page can read (one without is no longer offered, SEC-2).
        savedAt: new Date().toISOString(),
      }),
    );
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Form schema={schema()} resume="tab" onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /^resume$/i }));
    expect(await screen.findByRole('textbox')).toHaveValue('Ada');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/* ---------- Enter on one-tap questions ---------- */

describe('a double or held Enter never skips a one-tap question (QA retest)', () => {
  // An optional NPS: the owner unticked Required (CON-04).
  const nps: Question = { id: 'n', type: 'nps', title: 'How likely?', required: false };

  it('an Enter in the first moment after the question appears does nothing; later it skips', async () => {
    const { advance } = renderLive(nps);
    await screen.findByRole('button', { name: 'Skip' });
    await act(async () => {});
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(advance).not.toHaveBeenCalled();
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600);
    fireEvent.keyDown(window, { key: 'Enter' });
    later.mockRestore();
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('a held Enter (key repeat) never confirms or skips', async () => {
    const { advance } = renderLive(nps);
    await screen.findByRole('button', { name: 'Skip' });
    await act(async () => {});
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600);
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    later.mockRestore();
    expect(advance).not.toHaveBeenCalled();
  });

  it('Skip on a one-tap question is the quiet outlined button, OK the main one', async () => {
    renderLive(nps);
    expect(await screen.findByRole('button', { name: 'Skip' })).toHaveClass('slate-ok-btn--skip');
    const answered = renderLive({ ...nps, id: 'm' }, { m: 9 });
    expect(answered.getAllByRole('button', { name: /ok/i })[0]).not.toHaveClass(
      'slate-ok-btn--skip',
    );
  });

  it('a held Enter in a text box doesn’t submit it', async () => {
    const { advance } = renderLive({ id: 't', type: 'short_text', title: 'T' });
    const box = await screen.findByRole('textbox');
    fireEvent.keyDown(box, { key: 'Enter', repeat: true });
    expect(advance).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(advance).toHaveBeenCalledTimes(1);
  });
});

/* ---------- picks ---------- */

describe('repeated option values (CH-05)', () => {
  const dup = {
    id: 'pick',
    type: 'multi_choice',
    title: 'Pick',
    min: 4,
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'Option D', value: 'opt_4' },
      { label: 'Renamed E', value: 'opt_4' },
    ],
  } as Question;

  it('two options with one value count as one choice, so nobody is asked for more than exist', () => {
    expect(pickLimits(dup as never)).toEqual([3, Infinity]);
    expect(validate(dup, ['a', 'b', 'opt_4'])).toBeNull();
    expect(pickHint(dup as never)).toBe('Pick at least 3');
  });

  it('every page a respondent sees shows the first of each value only', () => {
    expect(uniqueByValue([{ value: 'x' }, { value: 'y' }, { value: 'x' }])).toEqual([
      { value: 'x' },
      { value: 'y' },
    ]);
    const [shown] = withoutRepeatedOptions([dup]);
    expect((shown as unknown as { options: unknown[] }).options).toHaveLength(3);
    const grid = {
      id: 'g',
      type: 'matrix',
      title: 'G',
      rows: [
        { label: 'Price', value: 'r' },
        { label: 'Quality', value: 'r' },
      ],
      columns: [{ label: 'Good', value: 'c' }],
    } as Question;
    expect((withoutRepeatedOptions([grid])[0] as unknown as { rows: unknown[] }).rows).toHaveLength(
      1,
    );
    // Nothing repeated: the very same schema comes back (no needless re-render).
    const clean = { brand: { name: 'B' }, theme: 'classic', questions: [grid] };
    const fixed = withoutRepeatedOptionsIn(clean as never);
    expect(fixed).not.toBe(clean);
    expect(withoutRepeatedOptionsIn(fixed)).toBe(fixed);
  });

  it('a portable link drops repeated values before the form renders', () => {
    const out = sanitizeUntrustedSchema({
      brand: { name: 'B' },
      theme: 'classic',
      questions: [dup],
    } as never);
    expect((out.questions[0] as unknown as { options: unknown[] }).options).toHaveLength(3);
  });
});

describe('a tap past the most picks says why (R5)', () => {
  const opts = Array.from({ length: 5 }, (_, i) => ({
    label: `Option ${String.fromCharCode(65 + i)}`,
    value: `o${i}`,
  }));

  it('multi choice: the note sits right under the option tapped, and goes once a pick changes', async () => {
    const { onSet } = renderLive({
      id: 'm',
      type: 'multi_choice',
      title: 'M',
      max: 2,
      options: opts,
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Option B/ }));
    const c = screen.getByRole('checkbox', { name: /Option C/ });
    expect(c).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(c);
    const why = 'You can pick up to 2. Tap one of your picks to let it go.';
    const note = screen.getByText(why, { selector: '.slate-choice-note' });
    expect(c.nextElementSibling).toBe(note);
    // Said by a region that's always there, not the note created with it (COPY-R8).
    expect(screen.getByText(why, { selector: '.slate-sr' })).toHaveAttribute('aria-live', 'polite');
    expect(onSet).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('checkbox', { name: /Option A/ }));
    expect(
      screen.queryByText(/You can pick up to 2/, { selector: '.slate-choice-note' }),
    ).toBeNull();
  });

  it('picture choice: the reason shows under the grid', async () => {
    renderLive({
      id: 'p',
      type: 'picture_choice',
      title: 'P',
      multiple: true,
      max: 1,
      options: opts.map((o) => ({ ...o, src: 'https://x.test/a.jpg' })),
    } as Question);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Option A/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Option B/ }));
    expect(
      screen.getByText('You can pick up to 1. Tap one of your picks to let it go.'),
    ).toBeInTheDocument();
  });
});

/* ---------- grid ---------- */

describe('a grid whose column headers can’t fit their words stacks (R7)', () => {
  it('stacks when a header word is wider than its column, and goes back when there is room', async () => {
    let resize: (width: number) => void = () => {};
    class FakeResizeObserver {
      constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
        resize = (width) => cb([{ contentRect: { width } }]);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let wordTooWide = true;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('slate-matrix-colhead') && wordTooWide ? 62 : 10;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(54);
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
    const labels = ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neutral'];
    renderLive({
      id: 'g',
      type: 'matrix',
      title: 'How do you feel?',
      rows: [{ label: 'Price', value: 'r1' }],
      columns: labels.map((label, i) => ({ label, value: `c${i}` })),
    } as Question);
    await screen.findAllByRole('radio');
    const grid = document.querySelector('.slate-matrix')!;
    act(() => resize(600));
    expect(grid).toHaveClass('slate-matrix--stack');
    wordTooWide = false;
    act(() => resize(1000));
    expect(grid).not.toHaveClass('slate-matrix--stack');
    vi.unstubAllGlobals();
  });
});

describe('a picture option with no link (QA coverage)', () => {
  it('draws no broken src, and React has nothing to warn about', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLive({
      id: 'p',
      type: 'picture_choice',
      title: 'Which look?',
      options: [
        { label: 'Modern', value: 'a', src: '' },
        { label: 'Rustic', value: 'b', src: 'https://x.test/b.jpg' },
      ],
    } as Question);
    const imgs = await screen.findAllByRole('img');
    expect(imgs[0]).not.toHaveAttribute('src');
    expect(imgs[1]).toHaveAttribute('src', 'https://x.test/b.jpg');
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/empty string/);
  });
});

/* ---------- swipe ---------- */

describe('a swipe card still flying when Back is pressed decides nothing (EXTRA-1)', () => {
  it('unmounting mid-fling never commits the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSet = vi.fn();
    const advance = vi.fn();
    const q = { id: 'yn', type: 'yes_no', title: 'Ready?', display: 'swipe' } as Question;
    const { unmount } = render(<Live question={q} advance={advance} onSet={onSet} />);
    const yes = await screen.findByRole('button', { name: /yes/i });
    // Give the card a running animation, as a browser would.
    const card = document.querySelector<HTMLElement>('.slate-swipe-card, .slate-swipe-yn-card');
    if (card) {
      card.animate = () =>
        ({ finished: new Promise(() => {}), cancel: () => {} }) as unknown as Animation;
    }
    fireEvent.click(yes);
    unmount(); // Back: the question leaves while the card is in the air
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSet).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });
});

/* ---------- files and photos ---------- */

describe('the upload type filter reads what owners type (R19, R22)', () => {
  const file = (name: string, type = '') => new File(['x'], name, { type });

  it('a bare "pdf", "jpg, png" or "images" work; .jpg and .jpeg are one type', () => {
    expect(acceptTokens('pdf')).toEqual(['.pdf']);
    expect(acceptTokens('jpg, png')).toEqual(['.jpg', '.png']);
    expect(acceptTokens('images')).toEqual(['image/*']);
    expect(matchesAccept(file('doc.pdf', 'application/pdf'), 'pdf')).toBe(true);
    expect(matchesAccept(file('photo.jpg', 'image/jpeg'), 'jpg, png')).toBe(true);
    expect(matchesAccept(file('photo-copy.jpeg', 'image/jpeg'), '.jpg')).toBe(true);
    expect(matchesAccept(file('photo.jpg', 'image/jpeg'), 'images')).toBe(true);
    expect(matchesAccept(file('notes.txt', 'text/plain'), 'pdf')).toBe(false);
  });

  it('a filter it can’t read at all takes every file instead of none', () => {
    expect(acceptTokens('documents please')).toEqual([]);
    expect(matchesAccept(file('doc.pdf'), 'documents please')).toBe(true);
  });
});

describe('a picked file that isn’t a photo says so in plain words (copy QA)', () => {
  it('one sentence, no format names', async () => {
    expect(NOT_A_PHOTO).toBe('That file isn’t a photo we can open. Try a different photo.');
    expect(SLATE_IMAGE_TYPE_HINT).not.toMatch(/HEIC|WebP|PNG|JPG/);
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await expect(normalizePickedImageFile(svg)).rejects.toThrow(NOT_A_PHOTO);
    await expect(prepareImageForStorage(svg)).rejects.toThrow(NOT_A_PHOTO);
    const txt = new File(['hi'], 'notes.txt', { type: 'text/plain' });
    await expect(normalizePickedImageFile(txt)).rejects.toThrow(NOT_A_PHOTO);
  });
});

/* ---------- focus ---------- */

describe('the studio’s live preview never takes the keyboard (S4, S15)', () => {
  it('a field inside [data-slate-preview] doesn’t focus itself on arrival', () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<input id="title"><div data-slate-preview><div class="slate-stage-content"><input id="answer"></div></div>';
    const title = document.getElementById('title') as HTMLInputElement;
    title.focus();
    focusAfter(document.getElementById('answer'));
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(title);
  });

  it('anywhere else it still does', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="slate-stage-content"><input id="answer"></div>';
    focusAfter(document.getElementById('answer'));
    vi.advanceTimersByTime(500);
    expect(document.activeElement).toBe(document.getElementById('answer'));
  });
});
