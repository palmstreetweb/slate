/**
 * Sign-up slots on the fill side (ADR-066), through the real <Form>: spots
 * left from `slotsLeft`, full slots and their waitlist, one pick that commits
 * and moves on, several picks with OK, letter keys, the last-spot moment, and
 * a submit that sends the respondent back to pick again (a slot filled while
 * they were answering) with every other answer kept.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Form, defineSchema } from '@/index.js';
import type { SignupSlotsQuestion, SlotsLeft } from '@/index.js';
import { ReducedMotionOverrideContext } from '@/hooks/useReducedMotion.js';

const swim: SignupSlotsQuestion = {
  id: 'swim',
  type: 'signup_slots',
  title: 'Pick a swim time',
  body: 'Each time fits a few families.',
  slots: [
    {
      label: 'Morning swim',
      value: 's_am',
      capacity: 8,
      date: '2026-10-03',
      start: '10:00',
      end: '11:00',
    },
    {
      label: 'Late morning',
      value: 's_late',
      capacity: 6,
      date: '2026-10-03',
      start: '11:00',
      end: '12:00',
    },
    {
      label: 'Lunch swim',
      value: 's_noon',
      capacity: 4,
      date: '2026-10-03',
      start: '12:00',
      end: '13:00',
    },
    {
      label: 'Sunday',
      value: 's_sun',
      capacity: 8,
      date: '2026-10-04',
      start: '10:00',
      end: '11:00',
    },
  ],
};

function schemaWith(question: SignupSlotsQuestion) {
  return defineSchema({
    brand: { name: 'Pool' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      { id: 'name', type: 'short_text', title: 'Your name?', required: true },
      question,
      { id: 'note', type: 'short_text', title: 'Anything else?' },
      { id: 'done', type: 'thanks', title: 'See you at the pool!' },
    ],
  });
}

const LEFT: SlotsLeft = { swim: { s_am: 3, s_late: 0, s_noon: 1, s_sun: 8 } };

async function toSlots(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox'), 'Ada');
  await user.keyboard('{Enter}');
  return screen.findByRole('heading', { name: 'Pick a swim time' });
}

/** A slot button: a radio for one pick, a checkbox for several. */
const slot = (name: RegExp) =>
  screen.queryByRole('radio', { name }) ?? screen.getByRole('checkbox', { name });

describe('sign-up slots: what respondents see', () => {
  it('groups slots by day and shows spots left, full and the last spot', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Form schema={schemaWith(swim)} slotsLeft={LEFT} onSubmit={vi.fn()} />,
    );
    await toSlots(user);
    await screen.findByRole('radiogroup', { name: 'Pick a swim time' });
    expect(screen.getByText('Each time fits a few families.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Saturday, October 3' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sunday, October 4' })).toBeInTheDocument();
    expect(slot(/^Morning swim/)).toHaveAccessibleName('Morning swim, 10–11 AM, 3 of 8 left');
    expect(slot(/^Late morning/)).toHaveAccessibleName('Late morning, 11 AM – 12 PM, Full');
    expect(slot(/^Late morning/)).toHaveAttribute('aria-disabled', 'true');
    expect(slot(/^Lunch swim/)).toHaveAccessibleName('Lunch swim, 12–1 PM, 1 spot left');
    expect(container.querySelectorAll('.slate-slot-meter')).toHaveLength(4);
  });

  it('without counts (a portable link) shows each slot’s capacity', async () => {
    const user = userEvent.setup();
    render(<Form schema={schemaWith(swim)} onSubmit={vi.fn()} />);
    await toSlots(user);
    expect(await screen.findByRole('radio', { name: /^Morning swim/ })).toHaveAccessibleName(
      'Morning swim, 10–11 AM, 8 spots',
    );
  });

  it('can hide the counts; full still says so', async () => {
    const user = userEvent.setup();
    render(
      <Form
        schema={schemaWith({ ...swim, showRemaining: false })}
        slotsLeft={LEFT}
        onSubmit={vi.fn()}
      />,
    );
    await toSlots(user);
    expect(await screen.findByRole('radio', { name: /^Morning swim/ })).toHaveAccessibleName(
      'Morning swim, 10–11 AM',
    );
    expect(slot(/^Late morning/)).toHaveAccessibleName(/Full$/);
  });
});

describe('sign-up slots: picking', () => {
  it('one pick commits and moves on; the answer is stored as { slots }', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Form schema={schemaWith(swim)} slotsLeft={LEFT} onSubmit={onSubmit} />);
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Morning swim/ }));
    expect(slot(/^Morning swim/)).toHaveAttribute('aria-checked', 'true');
    expect(slot(/^Morning swim/)).toHaveAccessibleName(/You’re in, 2 of 8 left$/);
    await screen.findByRole('heading', { name: 'Anything else?' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ name: 'Ada', swim: { slots: ['s_am'] } });
  });

  it('a full slot can’t be taken without a waitlist', async () => {
    const user = userEvent.setup();
    render(<Form schema={schemaWith(swim)} slotsLeft={LEFT} onSubmit={vi.fn()} />);
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Late morning/ }));
    // Under the slot, and said by the region that's always there (COPY-R8).
    for (const where of ['.slate-slot-note', '.slate-sr']) {
      expect(
        screen.getByText(/Late morning is full\. Please pick another\./, { selector: where }),
      ).toBeInTheDocument();
    }
    expect(slot(/^Late morning/)).toHaveAttribute('aria-checked', 'false');
  });

  it('with a waitlist, a full slot joins its waitlist', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <Form
        schema={schemaWith({ ...swim, waitlist: true })}
        slotsLeft={LEFT}
        onSubmit={onSubmit}
      />,
    );
    await toSlots(user);
    const late = await screen.findByRole('radio', { name: /^Late morning/ });
    expect(late).toHaveAccessibleName(/Full · join the waitlist$/);
    expect(late).not.toHaveAttribute('aria-disabled');
    await user.click(late);
    await screen.findByRole('heading', { name: 'Anything else?' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].swim).toEqual({ slots: [], wait: ['s_late'] });
  });

  it('several picks toggle, stop at the most per person, and wait for OK', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <Form schema={schemaWith({ ...swim, maxPicks: 2 })} slotsLeft={LEFT} onSubmit={onSubmit} />,
    );
    await toSlots(user);
    await screen.findByRole('group', { name: 'Pick a swim time' });
    await user.click(slot(/^Morning swim/));
    await user.click(slot(/^Sunday/));
    await user.click(slot(/^Lunch swim/));
    expect(
      screen.getByText(/You can pick up to 2/, { selector: '.slate-slot-note' }),
    ).toBeInTheDocument();
    await user.click(slot(/^Morning swim/)); // let it go
    await user.click(slot(/^Lunch swim/));
    await user.click(screen.getByRole('button', { name: /OK/ }));
    await screen.findByRole('heading', { name: 'Anything else?' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].swim).toEqual({ slots: ['s_sun', 's_noon'] });
  });

  it('letter keys pick slots in the order shown', async () => {
    const user = userEvent.setup();
    render(
      <Form schema={schemaWith({ ...swim, maxPicks: 3 })} slotsLeft={LEFT} onSubmit={vi.fn()} />,
    );
    await toSlots(user);
    await screen.findByRole('group', { name: 'Pick a swim time' });
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: 'A' });
    expect(slot(/^Sunday/)).toHaveAttribute('aria-checked', 'true');
    expect(slot(/^Morning swim/)).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(window, { key: 'b' }); // full, no waitlist
    expect(slot(/^Late morning/)).toHaveAttribute('aria-checked', 'false');
  });

  it('grabbing the last spot gets its moment, then moves on', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Form schema={schemaWith(swim)} slotsLeft={LEFT} onSubmit={vi.fn()} />,
    );
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Lunch swim/ }));
    const lunch = slot(/^Lunch swim/);
    expect(lunch).toHaveAccessibleName(/You got the last spot$/);
    expect(lunch).toHaveClass('slate-slot--grabbed');
    expect(within(lunch).getByText('Last spot!')).toBeInTheDocument();
    expect(container.querySelectorAll('.slate-slot-spark')).toHaveLength(8);
    expect(screen.getByText('You got the last spot: Lunch swim.')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Anything else?' }, { timeout: 2000 });
  });
});

describe('sign-up slots: calm motion (ADR-059)', () => {
  it('the last spot moves on at the usual beat, its stamp drawn and still', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ReducedMotionOverrideContext.Provider value={true}>
        <Form schema={schemaWith(swim)} slotsLeft={LEFT} onSubmit={vi.fn()} />
      </ReducedMotionOverrideContext.Provider>,
    );
    expect(container.querySelector('[data-slate-forms]')).toHaveAttribute('data-reduced-motion');
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Lunch swim/ }));
    expect(within(slot(/^Lunch swim/)).getByText('Last spot!')).toBeInTheDocument();
    // No 1.1 s hold: the usual ~220 ms commit beat.
    await screen.findByRole('heading', { name: 'Anything else?' }, { timeout: 700 });
  });
});

describe('sign-up slots: a slot that filled during the submit', () => {
  function Harness({ onSubmit }: { onSubmit: (a: Record<string, unknown>) => void }) {
    const [left, setLeft] = useState<SlotsLeft>(LEFT);
    const [tries, setTries] = useState(0);
    return (
      <Form
        schema={schemaWith(swim)}
        slotsLeft={left}
        onSubmit={async (answers) => {
          onSubmit(answers as Record<string, unknown>);
          setTries((n) => n + 1);
          if (tries === 0) {
            setLeft({ swim: { ...LEFT.swim, s_am: 0 } });
            throw Object.assign(new Error('Morning swim just filled up. Pick another.'), {
              goTo: 'swim',
            });
          }
        }}
      />
    );
  }

  it('returns to the question with the message, keeps answers, and re-submits the new pick', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Morning swim/ }));
    await screen.findByRole('heading', { name: 'Anything else?' });
    await user.type(screen.getByRole('textbox'), 'We’ll bring towels');
    await user.keyboard('{Enter}');

    // Back on the slots, told why, the full pick flagged.
    expect(await screen.findByRole('alert')).toHaveTextContent('Morning swim just filled up.');
    const morning = slot(/^Morning swim/);
    expect(morning).toHaveAccessibleName(/Just filled up$/);
    expect(morning).toHaveClass('slate-slot--conflict');
    await user.click(screen.getByRole('button', { name: /OK/ }));
    expect(
      screen.getByText(/Morning swim just filled up\. Please pick another\./),
    ).toBeInTheDocument();

    // Back (the ← in the top bar) goes to the name, not to the ending.
    await user.click(slot(/^Sunday/));
    await screen.findByRole('heading', { name: 'Anything else?' });
    expect(screen.getByRole('textbox')).toHaveValue('We’ll bring towels');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]![0]).toEqual({
      name: 'Ada',
      swim: { slots: ['s_sun'] },
      note: 'We’ll bring towels',
    });
    await screen.findByRole('heading', { name: 'See you at the pool!' });
  });

  it('Back from the question it returned to goes to the question before, not the ending', async () => {
    const user = userEvent.setup();
    render(<Harness onSubmit={vi.fn()} />);
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Morning swim/ }));
    await screen.findByRole('heading', { name: 'Anything else?' });
    await user.keyboard('{Enter}');
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByRole('heading', { name: 'Your name?' })).toBeInTheDocument();
  });

  it('an error without goTo still shows the ending’s Retry', async () => {
    const user = userEvent.setup();
    render(
      <Form
        schema={schemaWith(swim)}
        slotsLeft={LEFT}
        onSubmit={async () => {
          throw new Error('Network down');
        }}
      />,
    );
    await toSlots(user);
    await user.click(await screen.findByRole('radio', { name: /^Morning swim/ }));
    await screen.findByRole('heading', { name: 'Anything else?' });
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
