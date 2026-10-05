/**
 * QA pass 2026-10-04, the on-demand choice fields (ADR-069): the dropdown's
 * bare Enter, picture choice limits and Skip, swipe cards with Min / Max
 * Likes, package cards' Skip, sign-up slots when a tap can't be taken or
 * every spot is gone, ranking on touch, and the grid's messages.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { Question, SignupSlotsQuestion } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { RankingField } from '@/components/questions/RankingField.js';
import { FormConfirmRefContext, FormOtherRefContext } from '@/hooks/useRegisterFormConfirm.js';
import type { LooseAnswers } from '@/types/Answers.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** QuestionRenderer with its answers kept, like <Form> keeps them. */
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
  return (
    <FormConfirmRefContext.Provider value={confirmRef}>
      <FormOtherRefContext.Provider value={otherRef}>
        <div data-slate-forms="" data-theme-name="classic" data-theme="light">
          <QuestionRenderer
            question={question}
            answers={answers}
            setAnswer={(id, v) => {
              onSet?.(id, v);
              setAnswers((cur) => ({
                ...cur,
                [id]: typeof v === 'function' ? (v as (p: unknown) => unknown)(cur[id]) : v,
              }));
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
        <button type="button" data-testid="confirm" onClick={() => confirmRef.current?.()} />
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

/* ---------- dropdown: a bare Enter never picks (CH-10, GAP-01) ---------- */

const countries: Question = {
  id: 'country',
  type: 'dropdown',
  title: 'Country?',
  options: [
    { label: 'Albania', value: 'd1' },
    { label: 'Brazil', value: 'd2' },
    { label: 'Chile', value: 'd3' },
  ],
};

describe('dropdown: Enter picks only a row the respondent moved to', () => {
  it('a bare Enter on arrival asks for a pick instead of storing the first row', async () => {
    const { advance, onSet } = renderLive(countries);
    const input = await screen.findByRole('combobox');
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('! Please pick one')).toBeInTheDocument();
    expect(onSet).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('an optional dropdown moves on with nothing picked', async () => {
    const { advance, onSet } = renderLive({ ...countries, required: false } as Question);
    const input = await screen.findByRole('combobox');
    fireEvent.click(input); // the list opens on a click
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(advance).toHaveBeenCalled();
    expect(onSet).not.toHaveBeenCalled();
  });

  it('keeps a prefilled answer on Enter', async () => {
    const { advance, onSet } = renderLive(countries, { country: 'd2' });
    const input = await screen.findByRole('combobox');
    expect(input).toHaveValue('Brazil');
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).toHaveBeenLastCalledWith('country', 'd2');
    expect(advance).toHaveBeenCalled();
  });

  it('a row under a resting pointer is not picked; arrows and typing still are', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { onSet } = renderLive(countries);
      const input = await screen.findByRole('combobox');
      fireEvent.click(input);
      // The list opens under the cursor: an enter without a move picks nothing.
      fireEvent.mouseEnter(screen.getByRole('option', { name: 'Chile' }));
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSet).not.toHaveBeenCalledWith('country', 'd3');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSet).toHaveBeenLastCalledWith('country', 'd2');
      fireEvent.change(input, { target: { value: 'chi' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSet).toHaveBeenLastCalledWith('country', 'd3');
      act(() => {
        vi.advanceTimersByTime(400);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pointer that moves over a row highlights it', async () => {
    const { onSet } = renderLive(countries);
    const input = await screen.findByRole('combobox');
    fireEvent.click(input);
    fireEvent.mouseMove(screen.getByRole('option', { name: 'Chile' }));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).toHaveBeenLastCalledWith('country', 'd3');
  });
});

/* ---------- picture choice ---------- */

const pics = [
  { label: 'Red', value: 'r', src: 'r.jpg' },
  { label: 'Green', value: 'g', src: 'g.jpg' },
  { label: 'Blue', value: 'b', src: 'b.jpg' },
];

describe('picture choice: limits up front, and Skip when optional', () => {
  it('several picks: the rule, the maximum, and an error that clears', async () => {
    const q: Question = {
      id: 'p',
      type: 'picture_choice',
      title: 'Colors?',
      multiple: true,
      min: 1,
      max: 2,
      options: pics,
    };
    const { advance } = renderLive(q);
    expect(await screen.findByText('Pick at least 1, up to 2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm'));
    expect(screen.getByText('! Please pick at least one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /red/i }));
    expect(screen.queryByText('! Please pick at least one')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /green/i }));
    const blue = screen.getByRole('checkbox', { name: /blue/i });
    expect(blue).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(blue);
    expect(blue).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByTestId('confirm'));
    expect(advance).toHaveBeenCalled();
  });

  it('an optional single picture choice offers Skip', async () => {
    const { advance } = renderLive({
      id: 'p',
      type: 'picture_choice',
      title: 'Favorite?',
      required: false,
      options: pics,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(advance).toHaveBeenCalled();
  });

  it('a required single picture choice has no Skip, and no Enter to skip', async () => {
    const { advance } = renderLive({
      id: 'p',
      type: 'picture_choice',
      title: 'Fav?',
      options: pics,
    });
    await screen.findByRole('radio', { name: /red/i });
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm'));
    expect(advance).not.toHaveBeenCalled();
  });
});

/* ---------- package cards ---------- */

describe('package cards: Skip when optional (CH-09)', () => {
  it('offers Skip and moves on with nothing picked', async () => {
    const { advance, onSet } = renderLive({
      id: 'pkg',
      type: 'single_choice',
      display: 'cards',
      title: 'Package?',
      required: false,
      options: [
        { label: 'Basic', value: 'basic', price: 100 },
        { label: 'Plus', value: 'plus', price: 200 },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(advance).toHaveBeenCalled();
    expect(onSet).not.toHaveBeenCalled();
  });
});

/* ---------- swipe cards ---------- */

const deck: Question = {
  id: 'style',
  type: 'picture_choice',
  title: 'Which styles?',
  display: 'swipe',
  multiple: true,
  max: 1,
  options: [
    { label: 'Craftsman', value: 'craft', src: 'c.jpg' },
    { label: 'Farmhouse', value: 'farm', src: 'f.jpg' },
    { label: 'Spanish', value: 'spanish', src: 's.jpg' },
  ],
};

describe('swipe cards with Max Likes (CH-11, GAP-17)', () => {
  it('shows the limit, and a like past it springs back with a reason', async () => {
    renderLive(deck);
    await screen.findByRole('button', { name: 'Like Craftsman' });
    expect(screen.getByText('Like up to 1')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // like Craftsman
    const likeFarm = await screen.findByRole('button', { name: 'Like Farmhouse' });
    expect(likeFarm).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(likeFarm);
    expect(
      screen.getByText('! You can like up to 1. Pass on this one, or undo a like.'),
    ).toBeInTheDocument();
    // Still on Farmhouse: nothing was decided.
    expect(screen.getByRole('button', { name: 'Like Farmhouse' })).toBeInTheDocument();
  });

  it('on the end screen a liked picture can be let go, and Undo goes back a card', async () => {
    const { onSet } = renderLive({ ...deck, max: undefined } as Question, {
      style: ['craft', 'farm'],
    });
    expect(await screen.findByText('You liked 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Let Farmhouse go' }));
    expect(screen.getByText('You liked 1 of 3')).toBeInTheDocument();
    expect(onSet).toHaveBeenLastCalledWith('style', ['craft']);
    fireEvent.click(screen.getByRole('button', { name: 'Undo last' }));
    expect(screen.getByRole('button', { name: 'Like Spanish' })).toBeInTheDocument();
  });

  it('an optional yes / no card offers Skip', async () => {
    const { advance } = renderLive({
      id: 'yn',
      type: 'yes_no',
      display: 'swipe',
      title: 'Coffee?',
      required: false,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(advance).toHaveBeenCalled();
  });
});

/* ---------- sign-up slots ---------- */

const swim: SignupSlotsQuestion = {
  id: 'swim',
  type: 'signup_slots',
  title: 'Pick a swim time',
  slots: [
    { label: 'Morning', value: 's_am', capacity: 2 },
    { label: 'Noon', value: 's_noon', capacity: 2 },
    { label: 'Evening', value: 's_pm', capacity: 2 },
  ],
};

function swimForm(question: SignupSlotsQuestion, left: Record<string, number>) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <Form
      schema={defineSchema({
        brand: { name: 'Pool' },
        theme: 'classic',
        themeMode: 'light',
        questions: [question, { id: 'done', type: 'thanks', title: 'See you there.' }],
      })}
      slotsLeft={{ swim: left }}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('sign-up slots (MEDIA-07, GAP-16)', () => {
  it('every spot gone and no waitlist: it says so, and OK moves on without a pick', async () => {
    const user = userEvent.setup();
    const onSubmit = swimForm(swim, { s_am: 0, s_noon: 0, s_pm: 0 });
    expect(
      await screen.findByText('Sorry, every spot is taken. You can still send the rest.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^Morning/ }));
    expect(screen.getByText('! Sorry, every spot is taken.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^ok/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual({});
  });

  it('a tap past the most picks is answered right under the slot tapped', async () => {
    const user = userEvent.setup();
    swimForm({ ...swim, maxPicks: 2 }, { s_am: 2, s_noon: 2, s_pm: 2 });
    await user.click(await screen.findByRole('checkbox', { name: /^Morning/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Noon/ }));
    const evening = screen.getByRole('checkbox', { name: /^Evening/ });
    await user.click(evening);
    const note = screen.getByText('! You can pick up to 2. Tap one of your picks to let it go.');
    expect(evening.nextElementSibling).toBe(note);
    // A tap that works clears it.
    await user.click(screen.getByRole('checkbox', { name: /^Noon/ }));
    expect(note).not.toBeInTheDocument();
  });

  it('the key hint lists every key, and the full-slot message sits under that slot', async () => {
    const user = userEvent.setup();
    swimForm(swim, { s_am: 2, s_noon: 0, s_pm: 2 });
    expect(await screen.findByText('press A–C, or click to choose')).toBeInTheDocument();
    const noon = screen.getByRole('radio', { name: /^Noon/ });
    await user.click(noon);
    expect(noon.nextElementSibling).toHaveTextContent('! Noon is full. Please pick another.');
  });
});

/* ---------- ranking ---------- */

const rank: Question = {
  id: 'rank',
  type: 'ranking',
  title: 'Order these',
  options: [
    { label: 'Alpha', value: 'a' },
    { label: 'Beta', value: 'b' },
    { label: 'Gamma', value: 'c' },
  ],
};

const order = () =>
  Array.from(document.querySelectorAll('.slate-ranking-label')).map((n) => n.textContent);

describe('ranking (GAP-15, S23)', () => {
  it('says "Keep this order" until something moves, and stores that order', async () => {
    const { advance, onSet } = renderLive(rank);
    fireEvent.click(await screen.findByRole('button', { name: /keep this order/i }));
    expect(onSet).toHaveBeenLastCalledWith('rank', ['a', 'b', 'c']);
    expect(advance).toHaveBeenCalled();
  });

  it('↑ keeps focus on the item that moved, so a second ↑ moves it again', async () => {
    renderLive(rank);
    const up = await screen.findByRole('button', { name: 'Move Gamma up' });
    up.focus();
    fireEvent.click(up);
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Move Gamma up'));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(order()).toEqual(['Gamma', 'Alpha', 'Beta']);
    // At the top, focus moves to the button that still works.
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Move Gamma down'));
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
  });

  it('a finger drags by the grip; elsewhere on the row it scrolls the page', async () => {
    renderLive(rank);
    await screen.findByRole('button', { name: 'Move Alpha up' });
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.slate-ranking-row'));
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () =>
        ({
          top: i * 60,
          height: 50,
          bottom: i * 60 + 50,
          left: 0,
          right: 300,
          width: 300,
        }) as DOMRect;
    });
    // A touch on the row itself (not the grip) doesn't start a drag.
    fireEvent.pointerDown(rows[0]!, { pointerId: 1, pointerType: 'touch', clientY: 25 });
    fireEvent.pointerMove(rows[0]!, { pointerId: 1, pointerType: 'touch', clientY: 150 });
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']);
    // The grip drags.
    const grip = rows[0]!.querySelector('.slate-ranking-grip')!;
    fireEvent.pointerDown(grip, { pointerId: 2, pointerType: 'touch', clientY: 25 });
    fireEvent.pointerMove(grip, { pointerId: 2, pointerType: 'touch', clientY: 150 });
    fireEvent.pointerUp(grip, { pointerId: 2, pointerType: 'touch', clientY: 150 });
    expect(order()).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('options edited in the studio keep the order of those still there (S23)', () => {
    const props = { answers: {}, initialValue: undefined, onAnswer: vi.fn(), onAdvance: vi.fn() };
    const { rerender } = render(<RankingField question={rank as never} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Gamma up' }));
    expect(order()).toEqual(['Alpha', 'Gamma', 'Beta']);
    const edited = {
      ...rank,
      options: [
        { label: 'Beta', value: 'b' },
        { label: 'Gamma', value: 'c' },
        { label: 'Delta', value: 'd' },
      ],
    };
    rerender(<RankingField question={edited as never} {...props} />);
    expect(order()).toEqual(['Gamma', 'Beta', 'Delta']);
  });
});

/* ---------- grid ---------- */

describe('grid (CH-15, GAP-28)', () => {
  it('a cell tap stores the answer without a React warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const { onSet } = renderLive({
      id: 'g',
      type: 'matrix',
      title: 'Rate',
      rows: [{ label: 'Speed', value: 'r1' }],
      columns: [
        { label: 'Good', value: 'c1' },
        { label: 'Bad', value: 'c2' },
      ],
    });
    await user.click(await screen.findByRole('radio', { name: 'Speed: Good' }));
    expect(onSet).toHaveBeenLastCalledWith('g', { r1: 'c1' });
    expect(error).not.toHaveBeenCalled();
  });

  it('several rows still empty: says how many', async () => {
    renderLive({
      id: 'g',
      type: 'matrix',
      title: 'Rate',
      required: true,
      rows: [
        { label: 'Speed', value: 'r1' },
        { label: 'Price', value: 'r2' },
        { label: 'Care', value: 'r3' },
      ],
      columns: [{ label: 'Good', value: 'c1' }],
    });
    await screen.findByRole('radio', { name: 'Speed: Good' });
    fireEvent.click(screen.getByTestId('confirm'));
    expect(screen.getByText('! Please answer every row. 3 are still empty.')).toBeInTheDocument();
  });
});
