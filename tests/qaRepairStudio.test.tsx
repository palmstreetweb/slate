/**
 * QA repair pass (2026-10-05), the studio and the pages around the form: a
 * path nothing serves reads like a respondent's page, Build with AI keeps a
 * real 0 bound, picture links are checked, Responses read dates, phones,
 * removed options and grids in words, the live preview never takes the
 * keyboard, and the embedded form asks its host to bring each question's top
 * into view.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Question } from '@/index.js';
import { validate } from '@/logic/validation.js';
import { reviewText, usPhoneText } from '@/logic/reviewText.js';
import { formatAnswerFor } from '@/logic/piping.js';
import { isPublicRoute, isRespondentRoute, matchRoute } from '../examples/_admin/_router.js';
import { PageNotFound } from '../examples/_admin/pages/PageNotFound.js';
import { PAGE_NOT_FOUND } from '../examples/_admin/fillCopy.js';
import { mapGeneratedForm, blankGeneratedQuestion } from '../api/mapGeneratedForm.js';
import { generatedFormSchema } from '../api/generateFormSchema.js';
import { pictureLinkProblem, studioIssues } from '../examples/_admin/formChecks.js';
import {
  formatAnswerForCsv,
  formatAnswerForQuestion,
  isRemovedOptionValue,
} from '../examples/_admin/responsesFormat.js';
import { usePreviewFocusGuard } from '../examples/_admin/components/usePreviewFocusGuard.js';
import { SlateNumberInput } from '../examples/_admin/components/SlateNumberInput.js';
import { Canvas } from '../examples/_admin/components/Canvas.js';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ---------- F27 ---------- */

describe('a path nothing serves (F27)', () => {
  it('an old redirect or a form link with something stuck on its end is a respondent page', () => {
    for (const path of ['/forms/abc/example.com/thanks', '/thanks-page', '/nope/nope']) {
      const route = matchRoute(path);
      expect(route.name).toBe('notfound');
      // The small public bundle serves it, with no sign-in in front of it.
      expect(isRespondentRoute(route)).toBe(true);
      expect(isPublicRoute(route)).toBe(true);
    }
    // The studio's own pages are unchanged.
    expect(isRespondentRoute(matchRoute('/forms/f_1/edit'))).toBe(false);
    expect(isRespondentRoute(matchRoute('/'))).toBe(false);
  });

  it('says so in plain words: no raw path, no studio button', () => {
    window.history.replaceState({}, '', '/forms/abc/example.com/thanks');
    render(<PageNotFound />);
    expect(screen.getByRole('status')).toHaveTextContent(PAGE_NOT_FOUND);
    expect(PAGE_NOT_FOUND).toBe('We couldn’t find that page. Check the link you were sent.');
    expect(screen.queryByText(/example\.com|dashboard/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    window.history.replaceState({}, '', '/');
  });
});

/* ---------- R15 ---------- */

describe('Build with AI keeps a real 0 bound (R15)', () => {
  const validDraft = {
    title: 'Kids club',
    description: 'Sign up.',
    theme: 'editorial',
    welcome: { title: 'Welcome.', subtitle: '', cta: 'Start' },
    thanks: { title: 'Thanks.', subtitle: '', cta: 'Done' },
    estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
  };
  const draftWith = (questions: ReturnType<typeof blankGeneratedQuestion>[]) =>
    mapGeneratedForm(generatedFormSchema.parse({ ...validDraft, questions })).schema;

  it('"How many kids (0–10)?" refuses -2; "-5 to 0" keeps its max; 0 / 0 is still no limits', () => {
    const schema = draftWith([
      blankGeneratedQuestion({
        id: 'kids',
        type: 'number',
        title: 'How many kids?',
        min: 0,
        max: 10,
      }),
      blankGeneratedQuestion({ id: 'temp', type: 'number', title: 'How cold?', min: -5, max: 0 }),
      blankGeneratedQuestion({ id: 'budget', type: 'number', title: 'Budget?' }),
    ]);
    const by = Object.fromEntries(schema.questions.map((q) => [q.id, q])) as Record<
      string,
      Question
    >;
    expect(by.kids).toMatchObject({ min: 0, max: 10 });
    expect(validate(by.kids!, -2)).not.toBeNull();
    expect(by.temp).toMatchObject({ min: -5, max: 0 });
    expect(validate(by.temp!, 500)).not.toBeNull();
    expect(by.budget).not.toHaveProperty('min');
    expect(by.budget).not.toHaveProperty('max');
  });
});

/* ---------- picture links ---------- */

describe('picture option links (QA coverage)', () => {
  it('a blank or non-https link is said in plain words', () => {
    expect(pictureLinkProblem('')).toBe(
      'Add a link to a picture, or this option shows no picture.',
    );
    for (const bad of ['not a url', 'http://example.com/a.jpg', 'javascript:alert(1)']) {
      expect(pictureLinkProblem(bad)).toBe(
        'Use a picture link that starts with https://, or the picture won’t show.',
      );
    }
    expect(pictureLinkProblem('https://example.com/a.jpg')).toBeNull();
  });

  it('the editor lists it as a heads-up, naming the option', () => {
    const issues = studioIssues([
      {
        id: 'p',
        type: 'picture_choice',
        title: 'Which look?',
        options: [
          { label: 'Modern', value: 'a', src: 'https://example.com/a.jpg' },
          { label: 'Rustic', value: 'b', src: '' },
          { label: 'Coastal', value: 'c', src: 'http://example.com/c.jpg' },
        ],
      } as Question,
    ]);
    expect(issues).toEqual([
      {
        questionId: 'p',
        kind: 'picture_src',
        message:
          '“Which look?”: “Rustic” and 1 other need a picture link that starts with https://, or the picture won’t show.',
        blocking: false,
      },
    ]);
  });
});

/* ---------- Responses ---------- */

describe('Responses read answers in words (copy QA)', () => {
  it('dates in the form’s format; the CSV keeps them ISO so a sheet sorts them', () => {
    const date = { id: 'd', type: 'date', title: 'Pick a date' } as Question;
    expect(formatAnswerForQuestion(date, '2026-10-10')).toBe('10/10/2026');
    expect(
      formatAnswerForQuestion({ ...date, format: 'DD/MM/YYYY' } as Question, '2026-10-12'),
    ).toBe('12/10/2026');
    expect(formatAnswerForCsv(date, '2026-10-10')).toBe('2026-10-10');
  });

  it('a phone as people write it', () => {
    expect(usPhoneText('+18055550123')).toBe('(805) 555-0123');
    expect(usPhoneText('+442071838750')).toBe('+442071838750');
    const phone = { id: 'p', type: 'phone', title: 'Phone?' } as Question;
    expect(formatAnswerForQuestion(phone, '+18055550123')).toBe('(805) 555-0123');
    // The Review step too, for a phone and a contact block.
    expect(reviewText(phone, '+18055550123', formatAnswerFor)).toBe('(805) 555-0123');
    const contact = { id: 'c', type: 'contact_info', title: 'Reach you?' } as Question;
    expect(reviewText(contact, { name: 'Ana', phone: '+18055550123' }, formatAnswerFor)).toBe(
      'Ana · (805) 555-0123',
    );
  });

  it('an option deleted since reads "Removed option", never its code or as typed Other', () => {
    expect(isRemovedOptionValue('opt_19mrgr')).toBe(true);
    expect(isRemovedOptionValue('Pineapple')).toBe(false);
    const pick = {
      id: 'm',
      type: 'multi_choice',
      title: 'Pick any',
      allowOther: true,
      options: [{ label: 'Option A', value: 'opt_aaaaaa' }],
    } as Question;
    expect(formatAnswerForQuestion(pick, ['opt_aaaaaa', 'opt_19mrgr', 'Pineapple'])).toBe(
      'Option A, Removed option, Other: Pineapple',
    );
  });

  it('a grid row ticked then unticked is left out; several per row show every column', () => {
    const grid = {
      id: 'g',
      type: 'matrix',
      title: 'Grid multi',
      multiple: true,
      rows: [
        { label: 'Option A', value: 'r1' },
        { label: 'Option B', value: 'r2' },
      ],
      columns: [
        { label: 'Good', value: 'c1' },
        { label: 'Fast', value: 'c2' },
      ],
    } as Question;
    expect(formatAnswerForQuestion(grid, { r1: [], r2: ['c1', 'c2'] })).toBe(
      'Option B: Good, Fast',
    );
  });
});

/* ---------- S4 / S15 ---------- */

describe('the live preview never takes the keyboard (S4, S15)', () => {
  function Studio() {
    const guard = usePreviewFocusGuard();
    return (
      <div>
        <button type="button">Outline row</button>
        <div data-testid="frame" {...guard}>
          <input aria-label="Answer" />
        </div>
      </div>
    );
  }

  it('a Tab to an outline row, then a field focusing itself later, keeps the outline (S15 retest)', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Studio />);
    const row = screen.getByRole('button', { name: 'Outline row' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    row.focus();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // What a preview field used to do ~380 ms after it appeared.
    screen.getByLabelText('Answer').focus();
    expect(row).toHaveFocus();
  });

  it('a Tab that moves focus straight into the preview is the owner’s own', () => {
    render(<Studio />);
    const row = screen.getByRole('button', { name: 'Outline row' });
    row.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    screen.getByLabelText('Answer').focus();
    expect(screen.getByLabelText('Answer')).toHaveFocus();
  });

  it('the editor preview marks itself, so engine fields don’t focus themselves there', () => {
    const schema = {
      brand: { name: 'B' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { id: 'n', type: 'short_text', title: 'Name?' },
        { id: 'done', type: 'thanks', title: 'Thanks' },
      ],
    } as never;
    const { container } = render(
      <Canvas
        formId="f_x"
        schema={schema}
        selectedQuestion={{ id: 'n', type: 'short_text', title: 'Name?' } as Question}
      />,
    );
    const scroller = container.querySelector('.slate-canvas-frame > [data-slate-forms]')!;
    expect(scroller).toHaveAttribute('data-slate-preview');
    // The step counter sits at the foot of the question, not over its options.
    const counter = container.querySelector('.slate-footer')!;
    expect(counter.parentElement).not.toBe(scroller);
    expect((counter.parentElement as HTMLElement).style.position).toBe('relative');
  });

  it('a studio number field keeps its draft when focus is taken and handed straight back (S4)', async () => {
    const spy = vi.fn();
    function Field() {
      const [v, setV] = useState<number | undefined>(1);
      return (
        <>
          <SlateNumberInput
            aria-label="Step"
            above={0}
            value={v}
            onChange={(n) => {
              spy(n);
              setV(n);
            }}
          />
          {/* The editor's live preview carries data-slate-preview (Canvas). */}
          <div data-slate-preview="">
            <input aria-label="Preview answer" />
          </div>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Field />);
    const step = screen.getByRole('spinbutton', { name: 'Step' });
    await user.tripleClick(step);
    await user.keyboard('0.');
    // The preview takes focus, and the guard hands it straight back, within a frame.
    act(() => {
      screen.getByLabelText('Preview answer').focus();
      step.focus();
    });
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    await user.keyboard('25');
    expect(step).toHaveValue(0.25);
    expect(spy).toHaveBeenLastCalledWith(0.25);
    expect(spy).not.toHaveBeenCalledWith(25);
  });
});
