/**
 * QA pass 2026-10-04, choice and logic, through the whole <Form> (ADR-070):
 * the pick rule up front, the maximum that blocks extra picks (taps and
 * keys), errors that clear when fixed by keys, Other naming a picked option,
 * optional questions that can be skipped, and Review.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';
import type { Question } from '@/types/Question.js';

function schemaOf(questions: Question[]) {
  return defineSchema({
    brand: { name: 'Test' },
    theme: 'editorial',
    themeMode: 'light',
    questions: [...questions, { id: 'done', type: 'thanks', title: 'All set.' }],
  });
}

const TOPPINGS = [
  { label: 'Cheese', value: 'cheese' },
  { label: 'Olives', value: 'olives' },
  { label: 'Basil', value: 'basil' },
  { label: 'Onion', value: 'onion' },
];

const key = (k: string) => fireEvent.keyDown(window, { key: k });

describe('multi choice: the rule up front, and the maximum blocks extra picks (CH-06)', () => {
  it('says "Pick up to 2" and steps the other options back at 2', async () => {
    const user = userEvent.setup();
    render(
      <Form
        schema={schemaOf([
          { id: 'top', type: 'multi_choice', title: 'Toppings?', max: 2, options: TOPPINGS },
        ])}
        onSubmit={vi.fn()}
      />,
    );
    expect(await screen.findByText('Pick up to 2')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /cheese/i }));
    await user.click(screen.getByRole('checkbox', { name: /olives/i }));
    const basil = screen.getByRole('checkbox', { name: /basil/i });
    expect(basil).toHaveAttribute('aria-disabled', 'true');
    await user.click(basil);
    expect(basil).toHaveAttribute('aria-checked', 'false');
    // Letting one go makes room again.
    await user.click(screen.getByRole('checkbox', { name: /olives/i }));
    expect(basil).not.toHaveAttribute('aria-disabled');
  });

  it('letter keys stop at the maximum too', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          { id: 'top', type: 'multi_choice', title: 'Toppings?', max: 2, options: TOPPINGS },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await screen.findByText('Pick up to 2');
    key('a');
    key('b');
    key('c');
    expect(screen.getByRole('checkbox', { name: /basil/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    key('Enter');
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual({ top: ['cheese', 'olives'] });
  });

  it('an impossible setting (min 3, max 2) can still be answered', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'top',
            type: 'multi_choice',
            title: 'Toppings?',
            min: 3,
            max: 2,
            options: TOPPINGS,
          },
        ])}
        onSubmit={onSubmit}
      />,
    );
    expect(await screen.findByText('Pick at least 3')).toBeInTheDocument();
    for (const name of [/cheese/i, /olives/i, /basil/i]) {
      await user.click(screen.getByRole('checkbox', { name }));
    }
    await user.click(screen.getByRole('button', { name: /^ok/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });
});

describe('multi choice: errors clear when fixed with the letter keys (CH-07)', () => {
  it('"Pick at least 2" goes away once A and B are pressed', async () => {
    render(
      <Form
        schema={schemaOf([
          { id: 'top', type: 'multi_choice', title: 'Toppings?', min: 2, options: TOPPINGS },
        ])}
        onSubmit={vi.fn()}
      />,
    );
    // The rule line above the choices says it up front; the message under them says it again on OK.
    await screen.findByText('Pick at least 2');
    const message = () => document.querySelector('.slate-err');
    key('Enter');
    await waitFor(() => expect(message()).toHaveTextContent('Pick at least 2'));
    key('a');
    key('b');
    await waitFor(() => expect(message()).toBeNull());
  });
});

describe('multi choice: Other naming a picked option (CH-12)', () => {
  it('says so, instead of a count that contradicts what is ticked', async () => {
    const user = userEvent.setup();
    render(
      <Form
        schema={schemaOf([
          {
            id: 'top',
            type: 'multi_choice',
            title: 'Toppings?',
            min: 2,
            allowOther: true,
            options: TOPPINGS,
          },
        ])}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole('checkbox', { name: /cheese/i }));
    await user.click(screen.getByRole('checkbox', { name: /^e\s*other$/i }));
    await user.type(screen.getByRole('textbox'), 'cheese');
    await user.click(screen.getByRole('button', { name: /^ok/i }));
    expect(
      await screen.findByText('You already picked “Cheese”. Type something different.'),
    ).toBeInTheDocument();
  });
});

describe('optional single choice and yes/no can be skipped (CH-09)', () => {
  it('single choice: Skip, and Enter, move on with no answer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'size',
            type: 'single_choice',
            title: 'Size?',
            required: false,
            options: TOPPINGS,
          },
          { id: 'ok', type: 'yes_no', title: 'Fine?', required: false },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Fine?')).toBeInTheDocument();
    // Right as it appears, Enter waits (a double Enter mustn't skip it unseen)…
    key('Enter');
    expect(onSubmit).not.toHaveBeenCalled();
    // …a moment later it skips.
    const later = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600);
    key('Enter');
    later.mockRestore();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual({});
  });

  it('a required single choice or yes/no offers no Skip', () => {
    render(
      <Form
        schema={schemaOf([
          { id: 'size', type: 'single_choice', title: 'Size?', options: TOPPINGS },
        ])}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    render(
      <Form schema={schemaOf([{ id: 'ok', type: 'yes_no', title: 'Fine?' }])} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('the key hint lists the real keys (X3)', () => {
    render(
      <Form
        schema={schemaOf([
          { id: 'size', type: 'single_choice', title: 'Size?', options: TOPPINGS.slice(0, 3) },
        ])}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/press A–C, or click to choose/)).toBeInTheDocument();
  });
});

describe('Review (GAP-02, GAP-19, CH-13)', () => {
  const pets = { field: 'pets', op: 'equals', value: 'yes' } as const;

  it('asks questions a later answer revealed before Review, then lists answers in words', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'rate',
            type: 'matrix',
            title: 'Rate them',
            required: true,
            rows: [
              { label: 'Walks', value: 'r1' },
              { label: 'Food', value: 'r2' },
            ],
            columns: [
              { label: 'Good', value: 'c1' },
              { label: 'Bad', value: 'c2' },
            ],
            visibleIf: pets,
          },
          { id: 'pets', type: 'yes_no', title: 'Any pets?' },
          { id: 'check', type: 'review', title: 'All good?' },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /yes/i }));
    // The grid "Any pets?" revealed comes first, not Review.
    await user.click(await screen.findByRole('radio', { name: 'Walks: Good' }));
    await user.click(screen.getByRole('radio', { name: 'Food: Bad' }));
    await user.click(screen.getByRole('button', { name: /^ok/i }));
    // Then Review, with the grid read as labels, not codes.
    expect(await screen.findByText('Walks: Good · Food: Bad')).toBeInTheDocument();
    expect(screen.queryByText(/r1/)).not.toBeInTheDocument();
    // Edit → OK comes back to Review.
    await user.click(screen.getByRole('button', { name: /edit rate them/i }));
    await user.click(await screen.findByRole('button', { name: /^ok/i }));
    await user.click(await screen.findByRole('button', { name: /looks good/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual({ rate: { r1: 'c1', r2: 'c2' }, pets: 'yes' });
  });
});

describe('an edit from Review that changes where the form goes (ENG-01)', () => {
  // adult = no jumps to the "sorry" ending, past Review and the usual ending.
  const ageGate = defineSchema({
    brand: { name: 'Test' },
    theme: 'editorial',
    themeMode: 'light',
    questions: [
      {
        id: 'adult',
        type: 'single_choice',
        title: 'Are you 18 or older?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        logic: [{ if: { field: 'adult', op: 'equals', value: 'no' }, goTo: 'sorry' }],
      },
      { id: 'name', type: 'short_text', title: 'Your name?' },
      { id: 'check', type: 'review', title: 'Check your answers' },
      { id: 'done', type: 'thanks', title: 'All set.' },
      { id: 'sorry', type: 'thanks', title: 'Sorry, adults only.' },
    ],
  });

  it('goes to the ending the new answer leads to, not back to Review', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={ageGate} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: /yes/i }));
    await user.type(await screen.findByRole('textbox'), 'Ann{Enter}');
    await user.click(await screen.findByRole('button', { name: /edit are you 18/i }));
    await user.click(await screen.findByRole('radio', { name: /no/i }));
    expect(await screen.findByText('Sorry, adults only.')).toBeInTheDocument();
    expect(screen.queryByText('Check your answers')).not.toBeInTheDocument();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ adult: 'no' });
  });

  it('an edit that keeps the way to Review still comes back to it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={ageGate} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: /yes/i }));
    await user.type(await screen.findByRole('textbox'), 'Ann{Enter}');
    await user.click(await screen.findByRole('button', { name: /edit your name/i }));
    const box = await screen.findByRole('textbox');
    await user.clear(box);
    await user.type(box, 'Bea{Enter}');
    await user.click(await screen.findByRole('button', { name: /looks good/i }));
    expect(await screen.findByText('All set.')).toBeInTheDocument();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ adult: 'yes', name: 'Bea' });
  });

  it('a revealed question with its own jump goes where that jump leads', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'a',
            type: 'single_choice',
            title: 'Which one?',
            options: [
              { label: 'X', value: 'x' },
              { label: 'Y', value: 'y' },
            ],
            visibleIf: { field: 'b', op: 'equals', value: 'yes' },
            logic: [{ if: { field: 'a', op: 'equals', value: 'x' }, goTo: 'd' }],
          },
          { id: 'b', type: 'yes_no', title: 'Any pets?' },
          { id: 'c', type: 'short_text', title: 'Question C?' },
          { id: 'd', type: 'short_text', title: 'Question D?' },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /yes/i }));
    // The revealed question comes first; its jump then goes to D, not to C.
    await user.click(await screen.findByRole('radio', { name: /X/ }));
    expect(await screen.findByText('Question D?')).toBeInTheDocument();
    expect(screen.queryByText('Question C?')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'dd{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // The answer that showed the question is on the path the respondent took, so it is sent.
    expect(onSubmit.mock.calls[0]![0]).toEqual({ b: 'yes', a: 'x', d: 'dd' });
  });
});
