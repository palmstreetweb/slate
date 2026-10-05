/**
 * On-demand field UIs (ADR-063): the registry, stars / faces / slider, the
 * stepper, and date ranges with times. Each renders through QuestionRenderer,
 * so the lazy load, the placeholder and the shared prop contract are covered.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { Form, defineSchema } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { extFieldKey, preloadExtFields } from '@/components/questions/lazyFields.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
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

describe('registry', () => {
  it('maps variants to on-demand UIs and leaves the rest on their core field', () => {
    const scale = { id: 's', type: 'scale', title: 'S', min: 1, max: 5 } as const;
    // The numbers scale loads on demand too (QA pass), with the other long-standing fields.
    expect(extFieldKey(scale)).toBe('core-fields');
    expect(extFieldKey({ ...scale, display: 'numbers' })).toBe('core-fields');
    expect(extFieldKey({ ...scale, display: 'stars' })).toBe('scale-styled');
    expect(extFieldKey({ ...scale, display: 'emoji' })).toBe('scale-styled');
    expect(extFieldKey({ ...scale, display: 'slider' })).toBe('scale-styled');
    expect(extFieldKey({ id: 'n', type: 'number', title: 'N' })).toBe('core-fields');
    expect(extFieldKey({ id: 'u', type: 'url', title: 'U' })).toBe('core-fields');
    expect(extFieldKey({ id: 'n', type: 'number', title: 'N', display: 'stepper' })).toBe(
      'number-stepper',
    );
    // The plain date, phone, legal and NPS load on demand too (ADR-065).
    expect(extFieldKey({ id: 'd', type: 'date', title: 'D' })).toBe('core-fields');
    expect(extFieldKey({ id: 'p', type: 'phone', title: 'P' })).toBe('core-fields');
    expect(extFieldKey({ id: 'l', type: 'legal', title: 'L' })).toBe('core-fields');
    expect(extFieldKey({ id: 'n', type: 'nps', title: 'N' })).toBe('core-fields');
    expect(extFieldKey({ id: 'd', type: 'date', title: 'D', range: true })).toBe('date-extended');
    expect(extFieldKey({ id: 'd', type: 'date', title: 'D', includeTime: true })).toBe(
      'date-extended',
    );
    expect(extFieldKey({ id: 'f', type: 'file_upload', title: 'F' })).toBe('file-upload');
    expect(extFieldKey({ id: 't', type: 'short_text', title: 'T' })).toBeNull();
  });

  it('preloading is safe to call repeatedly', () => {
    const qs: Question[] = [
      { id: 's', type: 'scale', title: 'S', min: 1, max: 5, display: 'stars' },
      { id: 'n', type: 'number', title: 'N', display: 'stepper' },
    ];
    expect(() => {
      preloadExtFields(qs);
      preloadExtFields(qs);
    }).not.toThrow();
  });

  it('shows the title while the UI loads', () => {
    renderField({ id: 's', type: 'scale', title: 'Rate us', min: 1, max: 5, display: 'emoji' });
    expect(screen.getByRole('heading', { name: 'Rate us' })).toBeInTheDocument();
  });
});

describe('stars', () => {
  const q: Question = {
    id: 'rate',
    type: 'scale',
    title: 'How was the crew?',
    min: 1,
    max: 5,
    display: 'stars',
    minLabel: 'Poor',
    maxLabel: 'Great',
  };

  it('is a radiogroup of labelled stars; a tap commits and auto-advances', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { setAnswer, advance } = renderField(q);
      const group = await screen.findByRole('radiogroup', { name: 'How was the crew?' });
      const stars = screen.getAllByRole('radio');
      expect(group).toBeInTheDocument();
      expect(stars).toHaveLength(5);
      expect(stars[0]).toHaveAccessibleName('1 star, Poor');
      expect(stars[4]).toHaveAccessibleName('5 stars, Great');
      fireEvent.click(stars[3]!);
      expect(setAnswer).toHaveBeenCalledWith('rate', 4);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(advance).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the stored answer and uses one roving tab stop; arrows move focus', async () => {
    renderField(q, { rate: 3 });
    const stars = await screen.findAllByRole('radio');
    expect(stars[2]).toHaveAttribute('aria-checked', 'true');
    expect(stars.filter((s) => s.tabIndex === 0)).toEqual([stars[2]]);
    stars[2]!.focus();
    fireEvent.keyDown(stars[2]!, { key: 'ArrowRight' });
    expect(stars[3]).toHaveFocus();
    fireEvent.keyDown(stars[3]!, { key: 'Home' });
    expect(stars[0]).toHaveFocus();
    fireEvent.keyDown(stars[0]!, { key: 'End' });
    expect(stars[4]).toHaveFocus();
  });
});

describe('faces', () => {
  it('draws one face per point with the value, and commits a pick', async () => {
    const { setAnswer } = renderField({
      id: 'mood',
      type: 'scale',
      title: 'How do you feel?',
      min: 1,
      max: 5,
      display: 'emoji',
    });
    const faces = await screen.findAllByRole('radio');
    expect(faces).toHaveLength(5);
    expect(faces[0]).toHaveAccessibleName('1');
    expect(faces[0]!.querySelector('svg.slate-face')).not.toBeNull();
    fireEvent.click(faces[4]!);
    expect(setAnswer).toHaveBeenCalledWith('mood', 5);
  });
});

describe('slider', () => {
  const q: Question = {
    id: 'budget',
    type: 'scale',
    title: 'How urgent?',
    min: 0,
    max: 10,
    display: 'slider',
    required: true,
  };

  it('is a native range; untouched + required refuses OK', async () => {
    const { setAnswer, advance } = renderField(q);
    const slider = await screen.findByRole('slider', { name: 'How urgent?' });
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/not answered yet/i));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/move the slider to choose a number/i)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('dragging updates the readout; OK stores the value', async () => {
    const { setAnswer, advance, container } = renderField(q);
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '8' } });
    expect(slider).toHaveAttribute('aria-valuetext', '8');
    expect(container.querySelector('.slate-slider-value')).toHaveTextContent('8');
    fireEvent.keyDown(slider, { key: 'Enter' });
    expect(setAnswer).toHaveBeenCalledWith('budget', 8);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('number keys set the slider when it has focus', async () => {
    renderField(q);
    const slider = await screen.findByRole('slider');
    fireEvent.keyDown(slider, { key: '3' });
    expect(slider).toHaveValue('3');
  });

  it('an optional slider can be skipped', async () => {
    const { setAnswer, advance } = renderField({ ...q, required: false } as Question);
    await screen.findByRole('slider');
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).not.toHaveBeenCalled();
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('draws stars instead of a face when asked', async () => {
    const { container } = renderField({ ...q, sliderIcon: 'stars' } as Question);
    await screen.findByRole('slider');
    expect(container.querySelectorAll('.slate-slider-stars .slate-star')).toHaveLength(10);
    expect(container.querySelector('.slate-slider-face')).toBeNull();
  });
});

describe('number stepper', () => {
  const q: Question = {
    id: 'windows',
    type: 'number',
    title: 'How many windows?',
    display: 'stepper',
    min: 0,
    max: 3,
    unit: 'windows',
  };

  it('steps with the buttons, stops at the bounds, and submits what it shows', async () => {
    const { setAnswer, advance } = renderField(q);
    const box = await screen.findByRole('spinbutton', { name: 'How many windows?' });
    expect(box).toHaveValue('0');
    const plus = screen.getByRole('button', { name: /increase by 1/i });
    const minus = screen.getByRole('button', { name: /decrease by 1/i });
    expect(minus).toHaveAttribute('aria-disabled', 'true');
    for (let i = 0; i < 5; i++) fireEvent.click(plus, { detail: 0 });
    expect(box).toHaveValue('3');
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    expect(box).toHaveAttribute('aria-valuetext', '3 windows');
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('windows', 3);
    expect(advance).toHaveBeenCalled();
  });

  it('arrow keys step; typed values are validated on OK', async () => {
    const { setAnswer } = renderField(q, { windows: 1 });
    const box = await screen.findByRole('spinbutton');
    expect(box).toHaveValue('1');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box).toHaveValue('2');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveValue('1');
    fireEvent.change(box, { target: { value: '12' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText('Enter a number from 0 to 3 windows')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'lots' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByText(/please use numbers only, like 1500/i)).toBeInTheDocument();
    expect(setAnswer).not.toHaveBeenCalled();
  });

  it('holding a button repeats', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderField({ ...q, max: 100 } as Question);
      const box = await screen.findByRole('spinbutton');
      const plus = screen.getByRole('button', { name: /increase/i });
      fireEvent.pointerDown(plus, { button: 0 });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      fireEvent.pointerUp(plus);
      const held = Number((box as HTMLInputElement).value);
      expect(held).toBeGreaterThan(3);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(Number((box as HTMLInputElement).value)).toBe(held);
    } finally {
      vi.useRealTimers();
    }
  });

  it('decimal steps and a currency prefix', async () => {
    const { setAnswer } = renderField({
      id: 'budget',
      type: 'number',
      title: 'Budget?',
      display: 'stepper',
      step: 0.5,
      prefix: '$',
    });
    const box = await screen.findByRole('spinbutton');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box).toHaveValue('1.5');
    expect(box).toHaveAttribute('aria-valuetext', '$1.5');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(setAnswer).toHaveBeenCalledWith('budget', 1.5);
  });
});

describe('plain number with prefix and unit (on demand since ADR-065)', () => {
  it('shows the adornments; the answer stays a number', async () => {
    const { setAnswer } = renderField({
      id: 'area',
      type: 'number',
      title: 'Roof size?',
      prefix: '~',
      unit: 'sq ft',
    });
    const box = await screen.findByRole('textbox');
    expect(screen.getByText('sq ft')).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription('sq ft');
    fireEvent.change(box, { target: { value: '1800' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(setAnswer).toHaveBeenCalledWith('area', 1800);
  });
});

describe('date range and time', () => {
  it('a single date with a time stores YYYY-MM-DDTHH:MM (12-hour entry)', async () => {
    const user = userEvent.setup();
    const { setAnswer, advance } = renderField({
      id: 'appt',
      type: 'date',
      title: 'When should we come?',
      includeTime: true,
    });
    await screen.findByRole('textbox', { name: 'Month' });
    await user.type(screen.getByRole('textbox', { name: 'Month' }), '10');
    await user.type(screen.getByRole('textbox', { name: 'Day' }), '03');
    await user.type(screen.getByRole('textbox', { name: 'Year' }), '2026');
    await user.type(screen.getByRole('textbox', { name: 'Hour' }), '2');
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '30');
    // 2 o'clock reads as the afternoon until someone picks AM.
    expect(screen.getByRole('radio', { name: 'PM' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('appt', '2026-10-03T14:30');
    expect(advance).toHaveBeenCalled();
  });

  it('AM can be picked, and A/P keys set it', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderField({
      id: 'appt',
      type: 'date',
      title: 'When?',
      includeTime: true,
    });
    await screen.findByRole('textbox', { name: 'Month' });
    await user.type(screen.getByRole('textbox', { name: 'Month' }), '10');
    await user.type(screen.getByRole('textbox', { name: 'Day' }), '03');
    await user.type(screen.getByRole('textbox', { name: 'Year' }), '2026');
    await user.type(screen.getByRole('textbox', { name: 'Hour' }), '12');
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '15a');
    expect(screen.getByRole('radio', { name: 'AM' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('appt', '2026-10-03T00:15');
  });

  it('day-first forms use a 24-hour clock', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderField({
      id: 'appt',
      type: 'date',
      title: 'When?',
      includeTime: true,
      format: 'DD/MM/YYYY',
    });
    await screen.findByRole('textbox', { name: 'Day' });
    expect(screen.queryByRole('radio', { name: 'AM' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Day' }), '03');
    await user.type(screen.getByRole('textbox', { name: 'Month' }), '10');
    await user.type(screen.getByRole('textbox', { name: 'Year' }), '2026');
    await user.type(screen.getByRole('textbox', { name: 'Hour' }), '17');
    await user.type(screen.getByRole('textbox', { name: 'Minutes' }), '45');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('appt', '2026-10-03T17:45');
  });

  it('a range stores start/end and refuses an end before the start', async () => {
    const user = userEvent.setup();
    const { setAnswer } = renderField({
      id: 'stay',
      type: 'date',
      title: 'Which dates?',
      range: true,
      required: true,
    });
    const from = await screen.findByRole('group', { name: 'From' });
    const to = screen.getByRole('group', { name: 'To' });
    const inFrom = (n: string) => from.querySelector<HTMLInputElement>(`input[aria-label="${n}"]`)!;
    const inTo = (n: string) => to.querySelector<HTMLInputElement>(`input[aria-label="${n}"]`)!;
    await user.type(inFrom('Month'), '10');
    await user.type(inFrom('Day'), '07');
    await user.type(inFrom('Year'), '2026');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/please add an end date/i)).toBeInTheDocument();
    await user.type(inTo('Month'), '10');
    await user.type(inTo('Day'), '03');
    await user.type(inTo('Year'), '2026');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(screen.getByText(/can’t be before the start/i)).toBeInTheDocument();
    await user.clear(inTo('Day'));
    await user.type(inTo('Day'), '09');
    await user.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('stay', '2026-10-07/2026-10-09');
  });

  it('reopens a stored range for editing', async () => {
    renderField(
      { id: 'stay', type: 'date', title: 'Which dates?', range: true, includeTime: true },
      { stay: '2026-10-07T09:00/2026-10-09T17:30' },
    );
    const to = await screen.findByRole('group', { name: 'To' });
    expect(to.querySelector('input[aria-label="Hour"]')).toHaveValue('5');
    expect(to.querySelector('input[aria-label="Minutes"]')).toHaveValue('30');
    expect(screen.getAllByRole('radio', { name: 'PM', checked: true })).toHaveLength(1);
  });

  it('an optional, untouched range can be skipped', async () => {
    const { setAnswer, advance } = renderField({
      id: 'stay',
      type: 'date',
      title: 'Which dates?',
      range: true,
    });
    await screen.findByRole('group', { name: 'From' });
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(setAnswer).toHaveBeenCalledWith('stay', undefined);
    expect(advance).toHaveBeenCalled();
  });
});

describe('<Form> with on-demand fields', () => {
  it('number keys pick a star and advance; the slider waits for OK', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const schema = defineSchema({
      brand: { name: 'Pools' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { id: 'stars', type: 'scale', title: 'Stars?', min: 1, max: 5, display: 'stars' },
        { id: 'slide', type: 'scale', title: 'Slide?', min: 1, max: 5, display: 'slider' },
        { id: 'done', type: 'thanks', title: 'Thanks!' },
      ],
    });
    render(<Form schema={schema} onSubmit={onSubmit} />);
    await screen.findAllByRole('radio');
    await user.keyboard('4');
    const slider = await screen.findByRole('slider');
    // Focus is on the slider after the hand-off; move it off so the form's keys apply.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('2');
    await waitFor(() => expect(slider).toHaveValue('2'));
    expect(screen.getByText('Slide?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ok/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ stars: 4, slide: 2 });
  });
});
