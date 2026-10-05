/**
 * Review fixes of 2026-10-05, keys: Skip on Enter waits until the question
 * has been up a moment on picture choice, swipe yes / no and package cards
 * too (ENG-06), and a held Enter (key repeat) never confirms a typed box —
 * number, date, phone, website, date range / time, stepper, dropdown and the
 * multi-part fields (ENG-07).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { FormConfirmRefContext, FormOtherRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** QuestionRenderer with its answers kept, its OK on Enter, like <Form> runs it. */
function Live({ question, advance }: { question: Question; advance: () => void }) {
  const [answers, setAnswers] = useState<LooseAnswers>({});
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
          <QuestionRenderer
            question={question}
            answers={answers}
            setAnswer={(id, v) =>
              setAnswers(
                (cur) =>
                  ({
                    ...cur,
                    [id]: typeof v === 'function' ? (v as (p: unknown) => unknown)(cur[id]) : v,
                  }) as LooseAnswers,
              )
            }
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
      </FormOtherRefContext.Provider>
    </FormConfirmRefContext.Provider>
  );
}

function renderLive(question: Question) {
  const advance = vi.fn();
  const utils = render(<Live question={question} advance={advance} />);
  return { ...utils, advance };
}

const OPTIONS = [
  { label: 'Pizza', value: 'pizza', src: 'https://example.com/p.jpg' },
  { label: 'Tacos', value: 'tacos', src: 'https://example.com/t.jpg' },
];

describe('Skip on Enter waits a moment on picture choice, swipe yes / no and package cards (ENG-06)', () => {
  it.each([
    [
      'single picture choice',
      { id: 'p', type: 'picture_choice', title: 'Lunch?', options: OPTIONS, required: false },
    ],
    [
      'swipe yes / no',
      { id: 'y', type: 'yes_no', title: 'Pets?', display: 'swipe', required: false },
    ],
    [
      'package cards',
      {
        id: 'c',
        type: 'single_choice',
        title: 'Package?',
        display: 'cards',
        options: [
          { label: 'Basic', value: 'basic' },
          { label: 'Pro', value: 'pro' },
        ],
        required: false,
      },
    ],
  ] as const)('%s: an Enter right as it appears does nothing; later it skips', async (_, q) => {
    const { advance } = renderLive(q as Question);
    await screen.findByRole('button', { name: 'Skip' });
    await act(async () => {});
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(advance).not.toHaveBeenCalled();
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600);
    fireEvent.keyDown(window, { key: 'Enter' });
    later.mockRestore();
    expect(advance).toHaveBeenCalledTimes(1);
  });
});

describe('a held Enter never confirms a typed box (ENG-07)', () => {
  it.each([
    ['number', { id: 'n', type: 'number', title: 'How many?' }, '3'],
    ['website', { id: 'u', type: 'url', title: 'Your site?' }, 'example.com'],
    ['phone', { id: 'ph', type: 'phone', title: 'Phone?', defaultCountry: 'US' }, '8055550123'],
    ['stepper', { id: 's', type: 'number', title: 'Guests?', display: 'stepper' }, '2'],
  ] as const)('%s', async (_, q, text) => {
    const { advance } = renderLive(q as Question);
    const box = await screen
      .findByRole(q.type === 'number' && 'display' in q ? 'spinbutton' : 'textbox')
      .catch(() => screen.findAllByRole('textbox').then((all) => all[0]!));
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: 'Enter', repeat: true });
    await act(async () => {});
    expect(advance).not.toHaveBeenCalled();
  });

  it('a date and a dropdown', async () => {
    const date = renderLive({ id: 'd', type: 'date', title: 'When?', format: 'MM/DD/YYYY' });
    const [mm] = await screen.findAllByRole('textbox');
    fireEvent.keyDown(mm!, { key: 'Enter', repeat: true });
    await act(async () => {});
    expect(date.advance).not.toHaveBeenCalled();
    date.unmount();

    const drop = renderLive({
      id: 'dd',
      type: 'dropdown',
      title: 'City?',
      required: false,
      options: [
        { label: 'Austin', value: 'austin' },
        { label: 'Boston', value: 'boston' },
      ],
    });
    const combo = await screen.findByRole('combobox');
    fireEvent.keyDown(combo, { key: 'Enter', repeat: true });
    await act(async () => {});
    expect(drop.advance).not.toHaveBeenCalled();
    fireEvent.keyDown(combo, { key: 'Enter' });
    await waitFor(() => expect(drop.advance).toHaveBeenCalledTimes(1));
  });

  it('through the whole form: holding Enter after the first answer stops on the next question', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={defineSchema({
          brand: { name: 'Test' },
          theme: 'classic',
          themeMode: 'light',
          questions: [
            { id: 'n1', type: 'number', title: 'First number?' },
            { id: 'n2', type: 'number', title: 'Second number?' },
            { id: 'd1', type: 'date', title: 'A date?', format: 'MM/DD/YYYY' },
            { id: 'done', type: 'thanks', title: 'Done!' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );
    const first = await screen.findByRole('textbox');
    await user.type(first, '3');
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Second number?' })).toBeInTheDocument();
    // The auto-repeat keydowns land on the next box once focus moves there.
    const second = await screen.findByRole('textbox');
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(second, { key: 'Enter', repeat: true });
      await act(async () => {});
    }
    // The live question, not the outgoing copy laid over the stage.
    expect(screen.getByRole('heading', { name: 'Second number?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'A date?' })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
