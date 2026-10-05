/**
 * QA pass, fields / text / media (workstream w2b): ratings that can be
 * skipped and never pick on a stray Enter, stars named by their value, the
 * slider and stepper ignoring a scroll that starts on them, numbers read the
 * way people type them, dates that understand "26" and "3/7/2026", text that
 * is never cut silently, and messages in plain words.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useRef } from 'react';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import { validate, textMax } from '@/logic/validation.js';
import { parseTypedNumber } from '@/logic/numberEntry.js';
import { buildIsoDate, splitTypedDate, typedBox } from '@/logic/dateEntry.js';
import { nearestStep, scaleValues } from '@/components/questions/ext/scaleCells.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

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

// On-demand fields register their OK / Enter handler in an effect: let it run first.
const enter = async () => {
  await act(async () => {});
  fireEvent.keyDown(window, { key: 'Enter' });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('stars and faces (F4, F20, GAP-11)', () => {
  const stars: Question = {
    id: 'rate',
    type: 'scale',
    title: 'Rate us',
    min: 1,
    max: 5,
    display: 'stars',
    required: true,
  };

  it('an Enter right away picks nothing; a required rating says what to do', async () => {
    const { setAnswer, advance } = renderField(stars);
    await screen.findAllByRole('radio');
    await enter();
    expect(setAnswer).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(screen.getByText('! Please pick a rating')).toBeInTheDocument();
    // There is nothing to skip on a required rating.
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  });

  it('focus starts on the row, not on the first star', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderField(stars);
    const group = await screen.findByRole('radiogroup');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(group).toHaveFocus();
  });

  it('an optional rating can be skipped with Enter or the Skip button', async () => {
    const { setAnswer, advance } = renderField({ ...stars, required: false });
    await screen.findAllByRole('radio');
    await enter();
    expect(advance).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(advance).toHaveBeenCalledTimes(2);
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('Enter on the star the arrow keys moved to picks it', async () => {
    const { setAnswer } = renderField(stars);
    const group = await screen.findByRole('radiogroup');
    group.focus();
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('radio', { name: '1 star' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: '2 stars' })).toHaveFocus();
    await enter();
    expect(setAnswer).toHaveBeenCalledWith('rate', 2);
  });

  it('stars are named by the value they store', async () => {
    const { setAnswer } = renderField({ ...stars, min: 0, max: 5 });
    fireEvent.click(await screen.findByRole('radio', { name: '0 stars' }));
    expect(setAnswer).toHaveBeenCalledWith('rate', 0);
  });

  it('half steps read as half stars', async () => {
    renderField({ ...stars, min: 1, max: 5, step: 0.5 });
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(9);
    expect(screen.getByRole('radio', { name: '4.5 stars' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
  });
});

describe('numbers scale, NPS and legal: Skip / OK (F8, X2)', () => {
  it('an optional numbers scale shows Skip, and Enter moves on', async () => {
    const { advance } = renderField({ id: 's', type: 'scale', title: 'S', min: 0, max: 10 });
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(advance).toHaveBeenCalledTimes(1);
    await enter();
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it('a required scale says "Please pick a number" on Enter', async () => {
    const { advance } = renderField({
      id: 's',
      type: 'scale',
      title: 'S',
      min: 1,
      max: 5,
      required: true,
    });
    await screen.findAllByRole('radio');
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    await enter();
    expect(screen.getByText('! Please pick a number')).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('an answered scale (after Back) offers OK, which keeps the answer', async () => {
    const { advance, setAnswer } = renderField(
      { id: 's', type: 'scale', title: 'S', min: 1, max: 5, required: true },
      { s: 4 },
    );
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));
    expect(advance).toHaveBeenCalledTimes(1);
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('NPS: optional skips; required asks for a number', async () => {
    const first = renderField({ id: 'n', type: 'nps', title: 'N' });
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(first.advance).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = renderField({ id: 'n', type: 'nps', title: 'N', required: true });
    await screen.findAllByRole('radio');
    await enter();
    expect(screen.getByText('! Please pick a number')).toBeInTheDocument();
    expect(second.advance).not.toHaveBeenCalled();
  });

  it('legal: a required one says what to do on Enter; an optional one skips', async () => {
    const first = renderField({ id: 'l', type: 'legal', title: 'Terms?' });
    await screen.findAllByRole('radio');
    await enter();
    expect(screen.getByText('! Please choose an option')).toBeInTheDocument();
    expect(first.advance).not.toHaveBeenCalled();
    first.unmount();
    const second = renderField({ id: 'l', type: 'legal', title: 'Terms?', required: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(second.advance).toHaveBeenCalledTimes(1);
  });

  it('a 0.1 step reads 0, 0.1 … 1 with no float noise, and the top value is there (F21)', async () => {
    renderField({ id: 's', type: 'scale', title: 'S', min: 0, max: 1, step: 0.1 });
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      '0',
      '0.1',
      '0.2',
      '0.3',
      '0.4',
      '0.5',
      '0.6',
      '0.7',
      '0.8',
      '0.9',
      '1',
    ]);
  });

  it('a step of 0, a huge range or min above max never hangs or empties the scale (S16, F14)', async () => {
    expect(scaleValues({ min: 1, max: 5, step: 0 })).toEqual([1, 2, 3, 4, 5]);
    expect(scaleValues({ min: 0, max: 2_000_000 })).toHaveLength(21);
    expect(scaleValues({ min: 5, max: 1 })).toEqual([1, 2, 3, 4, 5]);
    renderField({ id: 's', type: 'scale', title: 'S', min: 0, max: 20000 });
    expect(await screen.findAllByRole('radio')).toHaveLength(21);
  });
});

describe('slider (SCROLL-10, GAP-10, F24)', () => {
  const q: Question = {
    id: 'slide',
    type: 'scale',
    title: 'How much?',
    min: 0,
    max: 100,
    step: 5,
    display: 'slider',
    required: true,
  };

  it('a scroll that starts on the slider leaves it unanswered', async () => {
    const { container } = renderField(q);
    const slider = await screen.findByRole('slider');
    fireEvent.pointerDown(slider, { pointerType: 'touch' });
    // Chromium moves a native range to the finger on touchstart…
    fireEvent.change(slider, { target: { value: '70' } });
    // …then the browser takes the gesture for a page scroll.
    fireEvent.pointerCancel(slider, { pointerType: 'touch' });
    expect(container.querySelector('.slate-slider-value')).toHaveTextContent('–');
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/not answered yet/i));
    await enter();
    expect(screen.getByText('! Move the slider to choose a number')).toBeInTheDocument();
  });

  it('a tap where the thumb sits still answers', async () => {
    const { setAnswer, advance } = renderField(q);
    const slider = await screen.findByRole('slider');
    fireEvent.pointerDown(slider, { pointerType: 'touch' });
    fireEvent.pointerUp(slider, { pointerType: 'touch' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('slide', 50);
    expect(advance).toHaveBeenCalled();
  });

  it('the untouched thumb sits in the real middle of a wide range', async () => {
    renderField({ ...q, step: 0.5 });
    expect(await screen.findByRole('slider')).toHaveValue('50');
  });

  it('a number key off the step grid snaps to the nearest step', async () => {
    renderField(q);
    const slider = await screen.findByRole('slider');
    fireEvent.keyDown(slider, { key: '7' });
    expect(slider).toHaveValue('5');
    expect(nearestStep({ min: 0, max: 100, step: 5 }, 8)).toBe(10);
  });
});

describe('typed numbers (F16, F17)', () => {
  it('reads numbers the way people type them, and refuses what nobody means', () => {
    expect(parseTypedNumber('1,000')).toBe(1000);
    expect(parseTypedNumber('$150')).toBe(150);
    expect(parseTypedNumber('$150', '$')).toBe(150);
    expect(parseTypedNumber('-$5')).toBe(-5);
    expect(parseTypedNumber('1 500')).toBe(1500);
    expect(parseTypedNumber('2,5')).toBe(2.5);
    expect(parseTypedNumber('１０')).toBe(10);
    expect(parseTypedNumber('1800 sq ft', '', 'sq ft')).toBe(1800);
    expect(parseTypedNumber('   ')).toBeUndefined();
    for (const junk of ['0x0A', '1e1', 'Infinity', '5abc', '.', '-', '1,5,0']) {
      expect(parseTypedNumber(junk)).toBeNaN();
    }
  });

  it('the number box takes "1,000" and refuses "0x0A" in plain words', async () => {
    const { setAnswer } = renderField({ id: 'n', type: 'number', title: 'How many?' });
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '0x0A' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('! Please use numbers only, like 1500')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '1,000' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(setAnswer).toHaveBeenCalledWith('n', 1000);
  });

  it('range messages say the range, with the prefix and unit', () => {
    const q = { id: 'n', type: 'number', title: 'N' } as const;
    expect(validate({ ...q, min: 1, max: 10 }, 0)?.message).toBe('Enter a number from 1 to 10');
    expect(validate({ ...q, min: 100, prefix: '$' }, 50)?.message).toBe('Enter $100 or more');
    expect(validate({ ...q, max: 3, unit: 'windows' }, 4)?.message).toBe('Enter 3 windows or less');
    expect(validate({ ...q, min: 0, max: 3, unit: 'windows' }, 12)?.message).toBe(
      'Enter a number from 0 to 3 windows',
    );
  });

  it('bounds set the wrong way round never trap anyone', () => {
    const q = { id: 'n', type: 'number', title: 'N', min: 5, max: 1 } as const;
    for (const n of [0, 1, 3, 5, 9]) expect(validate(q, n)).toBeNull();
    const d = { id: 'd', type: 'date', title: 'D', min: '2026-12-31', max: '2026-01-01' } as const;
    expect(validate(d, '2026-06-15')).toBeNull();
  });
});

describe('number stepper (X-3, F19)', () => {
  const q: Question = {
    id: 'w',
    type: 'number',
    title: 'How many windows?',
    display: 'stepper',
    min: 0,
    max: 5,
  };

  it('a scroll that starts on + leaves the number as it was', async () => {
    renderField(q);
    const box = await screen.findByRole('spinbutton');
    const plus = screen.getByRole('button', { name: /increase/i });
    fireEvent.pointerDown(plus, { button: 0, pointerType: 'touch' });
    fireEvent.pointerCancel(plus, { pointerType: 'touch' });
    expect(box).toHaveValue('0');
  });

  it('a tap on + steps once, when the finger lifts', async () => {
    renderField(q);
    const box = await screen.findByRole('spinbutton');
    const plus = screen.getByRole('button', { name: /increase/i });
    fireEvent.pointerDown(plus, { button: 0, pointerType: 'touch' });
    expect(box).toHaveValue('0');
    fireEvent.pointerUp(plus, { button: 0, pointerType: 'touch' });
    expect(box).toHaveValue('1');
  });

  it('a finger held on + still repeats', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderField(q);
    const box = await screen.findByRole('spinbutton');
    const plus = screen.getByRole('button', { name: /increase/i });
    fireEvent.pointerDown(plus, { button: 0, pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    fireEvent.pointerUp(plus, { button: 0, pointerType: 'touch' });
    expect(Number((box as HTMLInputElement).value)).toBeGreaterThan(1);
  });

  it('"-" at 0 says what is allowed instead of turning -2 into 02', async () => {
    renderField(q);
    const box = (await screen.findByRole('spinbutton')) as HTMLInputElement;
    fireEvent.keyDown(box, { key: '-' });
    expect(box).toHaveValue('0');
    expect(screen.getByText('! Enter a number from 0 to 5')).toBeInTheDocument();
    // The number is selected, so the 2 typed next replaces it.
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 1]);
  });

  it('with no lower limit, "-" is a minus sign, not a step', async () => {
    renderField({ id: 'w', type: 'number', title: 'Change?', display: 'stepper' });
    const box = await screen.findByRole('spinbutton');
    const ev = fireEvent.keyDown(box, { key: '-' });
    expect(ev).toBe(true); // not prevented: the browser types the minus
    expect(box).toHaveValue('0');
  });
});

describe('dates (F5, F29, F17, COPY-09)', () => {
  const d: Question = { id: 'd', type: 'date', title: 'When?', required: true };

  it('a 2-digit year means this century', async () => {
    const { setAnswer } = renderField(d);
    fireEvent.change(await screen.findByLabelText('Month'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '03' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '26' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('d', '2026-10-03');
    expect(screen.getByLabelText('Year')).toHaveValue('2026');
  });

  it('year 0000 and years before 1900 are refused in plain words', () => {
    expect(buildIsoDate({ month: '10', day: '03', year: '0000' }, 'MM/DD/YYYY')).toEqual({
      error: 'Please check the year. It should be 1900 or later.',
    });
    expect(buildIsoDate({ month: '10', day: '03', year: '202' }, 'MM/DD/YYYY')).toEqual({
      error: 'Please use a 4-digit year, like 2026',
    });
  });

  it('a partly filled date asks to finish it, in the form’s order', async () => {
    renderField({ ...d, format: 'DD/MM/YYYY' });
    fireEvent.change(await screen.findByLabelText('Month'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText('! Please finish the date (DD/MM/YYYY)')).toBeInTheDocument();
  });

  it('"3/7/2026" typed in one go fills the boxes', () => {
    expect(typedBox('month', '3')).toEqual({ digits: '3', done: true });
    expect(typedBox('month', '1/')).toEqual({ digits: '01', done: true });
    expect(typedBox('day', '7')).toEqual({ digits: '7', done: true });
    expect(typedBox('month', '1')).toEqual({ digits: '1', done: false });
    expect(typedBox('hour', '9:', 1)).toEqual({ digits: '09', done: true });
  });

  it('a pasted date fills all three boxes', async () => {
    const { setAnswer } = renderField(d);
    fireEvent.change(await screen.findByLabelText('Month'), { target: { value: '10/03/2026' } });
    expect(screen.getByLabelText('Day')).toHaveValue('03');
    expect(screen.getByLabelText('Year')).toHaveValue('2026');
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('d', '2026-10-03');
    expect(splitTypedDate('2026-10-03', 'DD/MM/YYYY')).toEqual({
      year: '2026',
      month: '10',
      day: '03',
    });
  });

  it('date limits read in the form’s own format', () => {
    const q = { ...d, min: '2026-10-10', max: '2026-12-31' } as Question;
    expect(validate(q, '2026-01-05')?.message).toBe('Pick a date on or after 10/10/2026');
    expect(validate({ ...q, format: 'DD/MM/YYYY' } as Question, '2027-01-05')?.message).toBe(
      'Pick a date on or before 31/12/2026',
    );
  });

  it('a date with a time takes "26" too, and says what is wrong with a time', async () => {
    const { setAnswer } = renderField({ ...d, includeTime: true, format: 'DD/MM/YYYY' });
    fireEvent.change(await screen.findByLabelText('Day'), { target: { value: '03' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '26' } });
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '00' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText('! Hours run from 0 to 23')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '09' } });
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText('! Minutes run from 00 to 59')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('d', '2026-10-03T09:30');
  });
});

describe('typed text (F9, F18, GAP-21)', () => {
  it('a long paste is kept whole: a counter shows it, and OK says how long it may be', async () => {
    const { setAnswer } = renderField({
      id: 't',
      type: 'short_text',
      title: 'Code?',
      maxLength: 10,
    });
    const box = await screen.findByRole('textbox');
    expect(box).not.toHaveAttribute('maxlength');
    fireEvent.change(box, { target: { value: 'PASTED-LONG-TEXT-123456' } });
    expect(box).toHaveValue('PASTED-LONG-TEXT-123456');
    expect(screen.getByText('23 / 10')).toHaveClass('slate-count--over');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('! Keep it to 10 characters or fewer')).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('a limit below 1 counts as unset; text otherwise stops at what the server keeps', () => {
    const q = { id: 't', type: 'short_text', title: 'T', required: true } as const;
    expect(validate({ ...q, maxLength: 0 }, 'hello')).toBeNull();
    expect(validate({ ...q, maxLength: -5 }, 'hello')).toBeNull();
    expect(textMax({ maxLength: 0 })).toBe(10000);
    expect(validate({ id: 'l', type: 'long_text', title: 'L' }, 'x'.repeat(10001))?.code).toBe(
      'too_long',
    );
  });

  it('a pattern without its own message says it in plain words', () => {
    expect(
      validate({ id: 't', type: 'short_text', title: 'T', pattern: /^\d+$/ }, 'abc')?.message,
    ).toBe('Please check the format');
  });

  it('long text on a phone: Return starts a new line instead of submitting', async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...real(query),
      matches: query === '(hover: none)',
    })) as typeof window.matchMedia;
    try {
      const { advance } = renderField({ id: 'l', type: 'long_text', title: 'Notes?' });
      const box = await screen.findByRole('textbox');
      fireEvent.change(box, { target: { value: 'line one' } });
      const ev = fireEvent.keyDown(box, { key: 'Enter' });
      expect(ev).toBe(true); // not prevented: the browser inserts the newline
      expect(advance).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = real;
    }
  });

  it('the message slot is always there, announced, and tied to the box', async () => {
    renderField({ id: 'e', type: 'email', title: 'Email?' });
    const box = await screen.findByRole('textbox');
    const slot = document.getElementById(box.getAttribute('aria-describedby')!)!;
    expect(slot).toHaveAttribute('aria-live', 'polite');
    expect(slot).toBeEmptyDOMElement();
    fireEvent.change(box, { target: { value: 'nope' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(slot).toHaveTextContent("! That doesn't look like a valid email");
    expect(box).toHaveAccessibleDescription("! That doesn't look like a valid email");
  });
});

describe('phone numbers (F13, F22)', () => {
  it('a missing or made-up default country reads local numbers as US ones', async () => {
    for (const defaultCountry of ['', 'XX', 'x']) {
      const { setAnswer, unmount } = renderField({
        id: 'p',
        type: 'phone',
        title: 'Phone?',
        defaultCountry,
      });
      const box = await screen.findByRole('textbox');
      fireEvent.change(box, { target: { value: '(805) 962-1234' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      await vi.waitFor(() => expect(setAnswer).toHaveBeenCalledWith('p', '+18059621234'));
      unmount();
    }
  });

  it('a number that doesn’t check out says how to fix it, naming the form’s country', async () => {
    renderField({ id: 'p', type: 'phone', title: 'Phone?', defaultCountry: 'GB' });
    const box = await screen.findByRole('textbox');
    fireEvent.change(box, { target: { value: '123' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(
      await screen.findByText(
        '! Please check the number, including the area code. For a number outside the United Kingdom, start with + and the country code.',
      ),
    ).toBeInTheDocument();
  });

  it('the contact block says the same about too few digits', async () => {
    renderField({
      id: 'c',
      type: 'contact_info',
      title: 'How do we reach you?',
      fields: { phone: 'required' },
    });
    fireEvent.change(await screen.findByRole('textbox', { name: /^name/i }), {
      target: { value: 'Ada' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^email/i }), {
      target: { value: 'a@b.co' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^phone/i }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(
      await screen.findByText(/Please check the number, including the area code/),
    ).toBeInTheDocument();
  });

  it('country names read mid-sentence; enough digits is a plausible number', async () => {
    const { countryName, looksLikePhone, phoneCountry } = await import('@/logic/phoneText.js');
    expect(countryName('US')).toBe('the United States');
    expect(countryName('CA')).toBe('Canada');
    expect(countryName('NL')).toBe('the Netherlands');
    expect(phoneCountry('gb', () => true)).toBe('GB');
    expect(phoneCountry('ZZ', () => false)).toBe('US');
    expect(looksLikePhone('555-1234')).toBe(true);
    expect(looksLikePhone('123')).toBe(false);
  });
});

describe('signature (F23, SCROLL-12)', () => {
  const sig: Question = { id: 's', type: 'signature', title: 'Sign here', required: true };
  const fakeRect = (el: HTMLElement) => {
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 500,
        height: 200,
        right: 500,
        bottom: 200,
        x: 0,
        y: 0,
      }) as DOMRect;
  };

  it('typed mode, left blank, asks for the name', async () => {
    renderField(sig);
    fireEvent.click(await screen.findByRole('button', { name: /type your name instead/i }));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText('! Please type your full name')).toBeInTheDocument();
  });

  it('an optional signature with only a dot says Clear skips it', async () => {
    const { advance } = renderField({ ...sig, required: false });
    const canvas = await screen.findByRole('img', { name: /signature pad/i });
    fakeRect(canvas);
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(
      screen.getByText('! That’s only a dot. Sign your full name, or tap Clear to skip.'),
    ).toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it('a quick up-flick that runs off the pad scrolls the page and leaves no mark', async () => {
    renderField(sig);
    const canvas = await screen.findByRole('img', { name: /signature pad/i });
    fakeRect(canvas);
    const scrollBy = vi.fn();
    // jsdom has no scrolling element; the page's stands in.
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      get: () => ({ scrollBy }),
    });
    const spy = {
      mockRestore: () => delete (document as { scrollingElement?: unknown }).scrollingElement,
    };
    try {
      const touch = { pointerId: 2, pointerType: 'touch', button: 0 };
      fireEvent.pointerDown(canvas, { ...touch, clientX: 250, clientY: 150 });
      fireEvent.pointerMove(canvas, { ...touch, clientX: 252, clientY: 60 });
      fireEvent.pointerMove(canvas, { ...touch, clientX: 255, clientY: -40 });
      fireEvent.pointerUp(canvas, touch);
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 190 }));
      // A real stroke across the pad is still ink.
      fireEvent.pointerDown(canvas, { ...touch, clientX: 40, clientY: 150 });
      fireEvent.pointerMove(canvas, { ...touch, clientX: 200, clientY: 60 });
      fireEvent.pointerMove(canvas, { ...touch, clientX: 400, clientY: 150 });
      fireEvent.pointerUp(canvas, touch);
      expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('location (MEDIA-15)', () => {
  const loc: Question = {
    id: 'where',
    type: 'location',
    title: 'Where is the job?',
    required: true,
  };

  it('with no service area, the privacy line doesn’t promise a verdict', async () => {
    renderField(loc);
    expect(
      await screen.findByText('We only save that you shared your location, not where you are.'),
    ).toBeInTheDocument();
  });

  it('the required message points at what is on screen', async () => {
    renderField(loc);
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }));
    expect(
      screen.getByText('! Please share your location, or type it instead'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Type it instead' }));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText('! Please type your town or ZIP code')).toBeInTheDocument();
  });
});

describe('availability (GAP-18, GAP-26)', () => {
  const q: Question = {
    id: 'when',
    type: 'availability',
    title: 'When are you free?',
    days: ['mon'],
    startTime: '09:00',
    endTime: '11:00',
    slotMinutes: 15,
  };

  it('says free time in minutes and hours, not fractions', async () => {
    renderField(q);
    const grid = await screen.findByRole('grid');
    const cell = (name: string) => screen.getByRole('gridcell', { name });
    cell('Monday 9 AM to 9:15 AM').focus();
    fireEvent.keyDown(grid, { key: ' ' });
    expect(screen.getByText('15 min free · Mon')).toBeInTheDocument();
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByText('1 hr 15 min free · Mon')).toBeInTheDocument();
  });

  it('a finger resting half a second before a swipe still scrolls; a held cell shows it is filling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { setAnswer } = renderField(q);
    await screen.findByRole('grid');
    const cell = screen.getByRole('gridcell', { name: 'Monday 9 AM to 9:15 AM' });
    const touch = { pointerId: 3, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 };
    fireEvent.pointerDown(cell, touch);
    expect(cell).toHaveClass('is-pressing');
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.pointerMove(cell, { ...touch, clientY: 40 });
    expect(cell).not.toHaveClass('is-pressing');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.pointerCancel(cell, touch);
    expect(setAnswer).not.toHaveBeenCalled();
  });
});

describe('thank-you redirect (F3)', () => {
  it('a link without https:// goes to that site, not to a page here', async () => {
    const { Form } = await import('@/index.js');
    const assign = vi.fn();
    const getter = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: 'https://slateforms.vercel.app/forms/12345678',
      assign,
    } as unknown as Location);
    try {
      for (const [redirectUrl, expected] of [
        ['example.com/thank-you', 'https://example.com/thank-you'],
        ['www.example.com', 'https://www.example.com/'],
        ['/done', 'https://slateforms.vercel.app/done'],
        ['javascript:alert(1)', null],
      ] as const) {
        assign.mockClear();
        const { unmount } = render(
          <Form
            schema={{
              brand: { name: 'Co' },
              theme: 'classic',
              themeMode: 'light',
              questions: [{ id: 'bye', type: 'thanks', title: 'Thanks', redirectUrl }],
            }}
            onSubmit={() => Promise.resolve()}
          />,
        );
        await screen.findByText(/response received/i);
        if (expected) expect(assign).toHaveBeenCalledWith(expected);
        else expect(assign).not.toHaveBeenCalled();
        unmount();
      }
    } finally {
      getter.mockRestore();
    }
  });
});
