/**
 * "Other: ___" on choice questions (ADR-063): the pure helpers, conditions,
 * every choice field, the letter key, Back, and the submit payload.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { Form, defineSchema, OTHER_VALUE } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext, FormOtherRefContext } from '@/hooks/useRegisterFormConfirm.js';
import {
  allowsOther,
  hasOtherAnswer,
  otherIndex,
  otherLabelOf,
  resolveOtherText,
  splitOther,
} from '@/logic/other.js';
import { evaluate } from '@/logic/conditional.js';
import { visibleQuestions } from '@/logic/progress.js';
import { computeScore } from '@/logic/scoring.js';
import { validate } from '@/logic/validation.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

const OPTIONS = [
  { label: 'Mailbox flyer', value: 'flyer', score: 2 },
  { label: 'Google', value: 'google', score: 1 },
];

describe('other.ts helpers', () => {
  it('allowsOther only for choice types with the flag on', () => {
    expect(
      allowsOther({
        id: 'a',
        type: 'single_choice',
        title: 'x',
        options: OPTIONS,
        allowOther: true,
      }),
    ).toBe(true);
    expect(allowsOther({ id: 'a', type: 'single_choice', title: 'x', options: OPTIONS })).toBe(
      false,
    );
    expect(
      allowsOther({
        id: 'a',
        type: 'multi_choice',
        title: 'x',
        options: OPTIONS,
        allowOther: true,
      }),
    ).toBe(true);
    expect(
      allowsOther({ id: 'a', type: 'dropdown', title: 'x', options: OPTIONS, allowOther: true }),
    ).toBe(true);
    expect(
      allowsOther({ id: 'a', type: 'picture_choice', title: 'x', options: [], allowOther: true }),
    ).toBe(true);
    expect(
      allowsOther({ id: 'a', type: 'ranking', title: 'x', options: OPTIONS } as Question),
    ).toBe(false);
  });

  it('otherLabelOf defaults to Other and trims', () => {
    expect(otherLabelOf({})).toBe('Other');
    expect(otherLabelOf({ otherLabel: '  ' })).toBe('Other');
    expect(otherLabelOf({ otherLabel: ' Something else ' })).toBe('Something else');
  });

  it('splitOther separates picked values from typed text', () => {
    expect(splitOther(OPTIONS, 'flyer')).toEqual({ picked: ['flyer'], other: '' });
    expect(splitOther(OPTIONS, 'Yard sign')).toEqual({ picked: [], other: 'Yard sign' });
    expect(splitOther(OPTIONS, ['google', 'Neighbor', 'flyer'])).toEqual({
      picked: ['google', 'flyer'],
      other: 'Neighbor',
    });
    expect(splitOther(OPTIONS, undefined)).toEqual({ picked: [], other: '' });
    expect(splitOther(OPTIONS, [1, null, '  '])).toEqual({ picked: [], other: '' });
  });

  it('resolveOtherText snaps to an option by value or label, else trims and caps', () => {
    expect(resolveOtherText(OPTIONS, 'google')).toEqual({ value: 'google', isOption: true });
    expect(resolveOtherText(OPTIONS, '  MAILBOX FLYER ')).toEqual({
      value: 'flyer',
      isOption: true,
    });
    expect(resolveOtherText(OPTIONS, '  Yard sign  ')).toEqual({
      value: 'Yard sign',
      isOption: false,
    });
    expect(resolveOtherText(OPTIONS, 'x'.repeat(900)).value).toHaveLength(500);
  });

  it('hasOtherAnswer is true only for non-empty text outside the options', () => {
    const values = new Set(['flyer', 'google']);
    expect(hasOtherAnswer('flyer', values)).toBe(false);
    expect(hasOtherAnswer('Yard sign', values)).toBe(true);
    expect(hasOtherAnswer(['flyer', 'Neighbor'], values)).toBe(true);
    expect(hasOtherAnswer(['flyer'], values)).toBe(false);
    expect(hasOtherAnswer('  ', values)).toBe(false);
    expect(hasOtherAnswer(undefined, values)).toBe(false);
  });
});

describe('conditions and scoring with Other', () => {
  const questions: Question[] = [
    { id: 'src', type: 'single_choice', title: 'Where?', options: OPTIONS, allowOther: true },
    {
      id: 'follow',
      type: 'short_text',
      title: 'Tell us more',
      visibleIf: { field: 'src', op: 'equals', value: OTHER_VALUE },
    },
    { id: 'plain', type: 'single_choice', title: 'Plain', options: OPTIONS },
  ];

  it('OTHER_VALUE matches typed text, never a picked option', () => {
    const idx = otherIndex(questions);
    const cond = { field: 'src', op: 'equals', value: OTHER_VALUE } as const;
    expect(evaluate(cond, { src: 'Yard sign' }, idx)).toBe(true);
    expect(evaluate(cond, { src: 'flyer' }, idx)).toBe(false);
    expect(evaluate(cond, {}, idx)).toBe(false);
    expect(
      evaluate({ field: 'src', op: 'not_equals', value: OTHER_VALUE }, { src: 'flyer' }, idx),
    ).toBe(true);
    expect(
      evaluate({ field: 'src', op: 'in', value: ['google', OTHER_VALUE] }, { src: 'Yard' }, idx),
    ).toBe(true);
    // Without the option index there is nothing to compare against.
    expect(evaluate(cond, { src: 'Yard sign' })).toBe(false);
    // A question that doesn't offer Other is never "Other".
    expect(
      evaluate({ field: 'plain', op: 'equals', value: OTHER_VALUE }, { plain: 'zzz' }, idx),
    ).toBe(false);
  });

  it('visibleQuestions shows the follow-up only after Other', () => {
    expect(visibleQuestions(questions, { src: 'flyer' }).map((q) => q.id)).toEqual([
      'src',
      'plain',
    ]);
    expect(visibleQuestions(questions, { src: 'Yard sign' }).map((q) => q.id)).toEqual([
      'src',
      'follow',
      'plain',
    ]);
  });

  it('typed Other text scores 0; picked options keep their score', () => {
    expect(computeScore(questions, { src: 'Yard sign' })).toBe(0);
    expect(computeScore(questions, { src: 'flyer' })).toBe(2);
  });

  it('validation counts Other as an answer (required and min/max)', () => {
    const single = questions[0]!;
    expect(validate(single, 'Yard sign')).toBeNull();
    const multi: Question = {
      id: 'm',
      type: 'multi_choice',
      title: 'Pick',
      options: OPTIONS,
      allowOther: true,
      min: 2,
    };
    expect(validate(multi, ['flyer', 'Neighbor'])).toBeNull();
    expect(validate(multi, ['Neighbor'])?.code).toBe('min_selections');
  });
});

/* ---------- field harness ---------- */

function Harness({
  question,
  answers,
  setAnswer,
  advance,
}: {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: unknown) => void;
  advance: () => void;
}) {
  const confirmRef = useRef<(() => void) | null>(null);
  const otherRef = useRef<(() => void) | null>(null);
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
      <FormOtherRefContext.Provider value={otherRef}>
        <QuestionRenderer
          question={question}
          answers={answers}
          setAnswer={setAnswer}
          advance={advance}
          stepNumber={1}
          totalSteps={2}
          submitStatus="idle"
          submitError={null}
          onRetrySubmit={vi.fn()}
          onRestart={vi.fn()}
        />
        <button type="button" data-testid="other-key" onClick={() => otherRef.current?.()} />
        <button type="button" data-testid="confirm" onClick={() => confirmRef.current?.()} />
      </FormOtherRefContext.Provider>
    </FormConfirmRefContext.Provider>
  );
}

function renderField(question: Question, answers: LooseAnswers = {}) {
  const setAnswer = vi.fn<(id: string, value: unknown) => void>();
  const advance = vi.fn<() => void>();
  const utils = render(
    <Harness question={question} answers={answers} setAnswer={setAnswer} advance={advance} />,
  );
  return { ...utils, setAnswer, advance };
}

describe('single choice with Other', () => {
  const q: Question = {
    id: 'src',
    type: 'single_choice',
    title: 'How did you hear about us?',
    options: OPTIONS,
    allowOther: true,
  };

  it('adds an Other radio with the next letter, and no box until picked', () => {
    renderField(q);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[2]).toHaveTextContent('C');
    expect(radios[2]).toHaveTextContent('Other');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('opening Other focuses the box; empty OK is an error; typed text commits and advances', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { setAnswer, advance } = renderField(q);
      fireEvent.click(screen.getByRole('radio', { name: /other/i }));
      const box = screen.getByRole('textbox', { name: /other: your answer/i });
      await waitFor(() => expect(box).toHaveFocus());
      expect(screen.getByRole('radio', { name: /other/i })).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(screen.getByRole('button', { name: /ok/i }));
      expect(screen.getByText(/please type your answer/i)).toBeInTheDocument();
      expect(setAnswer).not.toHaveBeenCalled();

      fireEvent.change(box, { target: { value: '  Yard sign  ' } });
      expect(screen.queryByText(/please type your answer/i)).not.toBeInTheDocument();
      fireEvent.keyDown(box, { key: 'Enter' });
      expect(setAnswer).toHaveBeenCalledWith('src', 'Yard sign');
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(advance).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('typing an option name stores that option', () => {
    const { setAnswer } = renderField(q);
    fireEvent.click(screen.getByRole('radio', { name: /other/i }));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'google' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(setAnswer).toHaveBeenCalledWith('src', 'google');
  });

  it('a stored typed answer reopens Other with the text (Back)', () => {
    renderField(q, { src: 'Yard sign' });
    expect(screen.getByRole('radio', { name: /other/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox')).toHaveValue('Yard sign');
    expect(screen.getByRole('radio', { name: /mailbox flyer/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('the Other key handler opens the box', () => {
    renderField(q);
    fireEvent.click(screen.getByTestId('other-key'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('picking a listed option closes the box', () => {
    const { setAnswer } = renderField(q);
    fireEvent.click(screen.getByRole('radio', { name: /other/i }));
    fireEvent.click(screen.getByRole('radio', { name: /google/i }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(setAnswer).toHaveBeenCalledWith('src', 'google');
  });

  it('uses a custom label', () => {
    renderField({ ...q, otherLabel: 'Something else' } as Question);
    expect(screen.getByRole('radio', { name: /something else/i })).toBeInTheDocument();
  });
});

describe('multi choice with Other', () => {
  const q: Question = {
    id: 'svc',
    type: 'multi_choice',
    title: 'Which services?',
    options: OPTIONS,
    allowOther: true,
  };

  it('stores picked options plus the typed text on OK', () => {
    const { setAnswer, advance } = renderField(q, { svc: ['google'] });
    const otherBox = screen.getByRole('checkbox', { name: /other/i });
    fireEvent.click(otherBox);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Referral' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenLastCalledWith('svc', ['google', 'Referral']);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('an open, empty Other box blocks OK', () => {
    const { advance } = renderField(q);
    fireEvent.click(screen.getByRole('checkbox', { name: /other/i }));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/please type your answer/i)).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('unticking Other drops the typed text from the answer', () => {
    const { setAnswer } = renderField(q, { svc: ['flyer', 'Referral'] });
    const other = screen.getByRole('checkbox', { name: /other/i });
    expect(other).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(other);
    expect(setAnswer).toHaveBeenLastCalledWith('svc', ['flyer']);
  });

  it('toggling an option keeps the typed text', () => {
    const { setAnswer } = renderField(q, { svc: ['Referral'] });
    fireEvent.click(screen.getByRole('checkbox', { name: /google/i }));
    expect(setAnswer).toHaveBeenLastCalledWith('svc', ['google', 'Referral']);
  });
});

describe('dropdown with Other', () => {
  const q: Question = {
    id: 'town',
    type: 'dropdown',
    title: 'Town?',
    options: [
      { label: 'Ojai', value: 'ojai' },
      { label: 'Ventura', value: 'ventura' },
    ],
    allowOther: true,
  };

  // The dropdown loads on demand (ADR-065): each test waits for the field.
  it('offers the typed text as Other and stores it', async () => {
    const { setAnswer, advance } = renderField(q);
    const input = await screen.findByRole('combobox');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.change(input, { target: { value: 'Oak View' } });
      const other = screen.getByRole('option', { name: /other: “oak view”/i });
      fireEvent.click(other);
      expect(setAnswer).toHaveBeenCalledWith('town', 'Oak View');
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(advance).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Enter on unmatched text stores it as Other', async () => {
    const { setAnswer } = renderField(q);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Oak View' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenLastCalledWith('town', 'Oak View');
  });

  it('without allowOther unmatched text is still refused', async () => {
    const { setAnswer } = renderField({ ...q, allowOther: false } as Question);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Oak View' } });
    expect(screen.queryByRole('option', { name: /other/i })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/please pick one/i)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalledWith('town', 'Oak View');
  });

  it('a stored typed answer shows in the box', async () => {
    renderField(q, { town: 'Oak View' });
    expect(await screen.findByRole('combobox')).toHaveValue('Oak View');
  });
});

describe('picture choice with Other', () => {
  const q: Question = {
    id: 'style',
    type: 'picture_choice',
    title: 'Style?',
    options: [
      { label: 'Modern', value: 'modern', src: 'https://example.com/m.jpg' },
      { label: 'Classic', value: 'classic', src: 'https://example.com/c.jpg' },
    ],
    allowOther: true,
  };

  // Picture choice loads on demand (ADR-064): wait for the grid.
  it('adds an Other tile that opens a box; the typed text commits', async () => {
    const { setAnswer } = renderField(q);
    const tile = await screen.findByRole('radio', { name: /other/i });
    expect(tile).toHaveTextContent('C');
    fireEvent.click(tile);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Farmhouse' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(setAnswer).toHaveBeenCalledWith('style', 'Farmhouse');
  });

  it('multiple mode merges picked tiles with the text', async () => {
    const { setAnswer, advance } = renderField({ ...q, multiple: true } as Question);
    fireEvent.click(await screen.findByRole('checkbox', { name: /modern/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /other/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Farmhouse' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenLastCalledWith('style', ['Farmhouse']);
    expect(advance).toHaveBeenCalled();
  });
});

describe('<Form> with Other', () => {
  const schema = defineSchema({
    brand: { name: 'Pools' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      {
        id: 'src',
        type: 'single_choice',
        title: 'How did you hear about us?',
        options: [
          { label: 'Mailbox flyer', value: 'flyer' },
          { label: 'Google', value: 'google' },
        ],
        allowOther: true,
      },
      {
        id: 'more',
        type: 'short_text',
        title: 'Where exactly?',
        visibleIf: { field: 'src', op: 'equals', value: OTHER_VALUE },
      },
      { id: 'done', type: 'thanks', title: 'Thanks!' },
    ],
  });

  it('the letter after the last option opens Other; the typed text is submitted and drives logic', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} onSubmit={onSubmit} />);
    await user.keyboard('c');
    const box = await screen.findByRole('textbox', { name: /other: your answer/i });
    await waitFor(() => expect(box).toHaveFocus());
    // Letters typed into the box are text, not shortcuts.
    await user.keyboard('A yard sign{Enter}');
    expect(await screen.findByText('Where exactly?')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'Oak St{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ src: 'A yard sign', more: 'Oak St' });
  });

  it('Back shows the typed Other answer again', async () => {
    const user = userEvent.setup();
    render(<Form schema={schema} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: /other/i }));
    await user.type(await screen.findByRole('textbox'), 'Neighbor{Enter}');
    expect(await screen.findByText('Where exactly?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    const box = await screen.findByRole('textbox', { name: /other: your answer/i });
    expect(box).toHaveValue('Neighbor');
  });
});
