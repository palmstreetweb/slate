/**
 * Review fixes of 2026-10-05, the respondent's path (ADR-069 part A §4):
 * a jump is decided on what had been answered when the respondent first left
 * its question (CON-01), so answers given later never move the path behind
 * them; Review lists the path navigation and the submit use (ENG-05) and
 * shows no step badge (ENG-09); an advance from a step the path no longer
 * holds goes on along the path; the score counts what is sent (CON-07).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema, OTHER_VALUE } from '@/index.js';
import type { Question } from '@/types/Question.js';
import { pathOf, visibleQuestions } from '@/logic/progress.js';
import { useFormState } from '@/hooks/useFormState.js';

function schemaOf(questions: Question[], ending: Question[] = []) {
  return defineSchema({
    brand: { name: 'Test' },
    theme: 'editorial',
    themeMode: 'light',
    questions: [...questions, { id: 'done', type: 'thanks', title: 'All set.' }, ...ending],
  });
}

const typeIn = async (user: ReturnType<typeof userEvent.setup>, text: string) =>
  user.type(await screen.findByRole('textbox'), `${text}{Enter}`);

describe('a jump is decided on the answers given by then (CON-01)', () => {
  it('a rule reading a later answer never drops the answers given after it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'q1',
            type: 'short_text',
            title: 'Your name?',
            logic: [{ if: { field: 'q3', op: 'equals', value: 'yes' }, goTo: 'done' }],
          },
          { id: 'q2', type: 'short_text', title: 'Your email?' },
          { id: 'q3', type: 'yes_no', title: 'Subscribe?' },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await typeIn(user, 'Ann');
    await typeIn(user, 'a@b.co');
    await user.click(await screen.findByRole('radio', { name: /yes/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ q1: 'Ann', q2: 'a@b.co', q3: 'yes' });
  });

  it('a jump to a question a later answer shows keeps the answers before it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'q1',
            type: 'short_text',
            title: 'Q one?',
            logic: [{ if: { field: 'q1', op: 'is_not_empty' }, goTo: 'q5' }],
          },
          { id: 'q2', type: 'short_text', title: 'Q two?' },
          { id: 'q4', type: 'yes_no', title: 'Q four?' },
          {
            id: 'q5',
            type: 'short_text',
            title: 'Q five?',
            visibleIf: { field: 'q4', op: 'equals', value: 'yes' },
          },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await typeIn(user, 'a');
    expect(await screen.findByText('Q two?')).toBeInTheDocument();
    await typeIn(user, 'b');
    await user.click(await screen.findByRole('radio', { name: /yes/i }));
    expect(await screen.findByText('Q five?')).toBeInTheDocument();
    await typeIn(user, 'e');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ q1: 'a', q2: 'b', q4: 'yes', q5: 'e' });
  });

  it('Back and on again goes where the form went the first time', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'q1',
            type: 'short_text',
            title: 'Q one?',
            logic: [{ if: { field: 'q3', op: 'equals', value: 'yes' }, goTo: 'done' }],
          },
          { id: 'q2', type: 'short_text', title: 'Q two?' },
          { id: 'q3', type: 'yes_no', title: 'Q three?' },
          { id: 'q4', type: 'short_text', title: 'Q four?' },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await typeIn(user, 'a');
    await typeIn(user, 'b');
    await user.click(await screen.findByRole('radio', { name: /yes/i }));
    expect(await screen.findByText('Q four?')).toBeInTheDocument();
    // Back to the first question, and on: Q two again, not the ending.
    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(await screen.findByRole('button', { name: /back/i }));
    await user.click(await screen.findByRole('button', { name: /back/i }));
    expect(await screen.findByText('Q one?')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(await screen.findByText('Q two?')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a rule reading a later question the link filled in still fires', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'name',
            type: 'short_text',
            title: 'Your name?',
            logic: [{ if: { field: 'plan', op: 'is_not_empty' }, goTo: 'notes' }],
          },
          {
            id: 'plan',
            type: 'single_choice',
            title: 'Which plan?',
            prefillKey: 'plan',
            options: [
              { label: 'Basic', value: 'basic' },
              { label: 'Pro', value: 'pro' },
            ],
          },
          { id: 'notes', type: 'short_text', title: 'Anything else?' },
        ])}
        onSubmit={onSubmit}
        prefill={{ plan: 'pro' }}
      />,
    );
    await typeIn(user, 'Ann');
    expect(await screen.findByText('Anything else?')).toBeInTheDocument();
    expect(screen.queryByText('Which plan?')).not.toBeInTheDocument();
    await typeIn(user, 'none');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ name: 'Ann', notes: 'none' });
  });

  it('pathOf replays jumps on what came before each step, and keeps the link’s answers', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        type: 'short_text',
        title: 'Q1',
        logic: [{ if: { field: 'q3', op: 'equals', value: 'yes' }, goTo: 'end' }],
      },
      { id: 'q2', type: 'short_text', title: 'Q2' },
      { id: 'q3', type: 'yes_no', title: 'Q3' },
      { id: 'end', type: 'thanks', title: 'Bye' },
    ];
    const answers = { q1: 'a', q2: 'b', q3: 'yes' };
    const visible = visibleQuestions(questions, answers);
    const ids = (p: number[]) => p.map((i) => visible[i]!.id);
    expect(ids(pathOf(visible, answers))).toEqual(['q1', 'q2', 'q3', 'end']);
    expect(ids(pathOf(visible, answers, undefined, undefined, { q3: 'yes' }))).toEqual([
      'q1',
      'end',
    ]);
  });

  it('a question a later answer shows comes right after that answer, and its jump leads on', () => {
    const questions: Question[] = [
      {
        id: 'kind',
        type: 'single_choice',
        title: 'Which kind?',
        options: [
          { label: 'X', value: 'x' },
          { label: 'Y', value: 'y' },
        ],
        visibleIf: { field: 'pets', op: 'equals', value: 'yes' },
        logic: [{ if: { field: 'kind', op: 'equals', value: 'x' }, goTo: 'last' }],
      },
      { id: 'pets', type: 'yes_no', title: 'Pets?' },
      { id: 'mid', type: 'short_text', title: 'Mid' },
      { id: 'last', type: 'short_text', title: 'Last' },
      { id: 'end', type: 'thanks', title: 'Bye' },
    ];
    const ids = (answers: Record<string, string>) => {
      const visible = visibleQuestions(questions, answers);
      return pathOf(visible, answers).map((i) => visible[i]!.id);
    };
    // Shown by "Pets?", so asked after it; its jump then passes over "Mid".
    expect(ids({ pets: 'yes', kind: 'x' })).toEqual(['pets', 'kind', 'last', 'end']);
    // No jump: on to where "Pets?" was going.
    expect(ids({ pets: 'yes', kind: 'y' })).toEqual(['pets', 'kind', 'mid', 'last', 'end']);
    expect(ids({ pets: 'no', kind: 'x' })).toEqual(['pets', 'mid', 'last', 'end']);
  });

  it('a jump back to an earlier question still goes back (ADR-015)', () => {
    const { result } = renderHook(() =>
      useFormState(
        schemaOf([
          { id: 'q1', type: 'short_text', title: 'Q1' },
          { id: 'q2', type: 'short_text', title: 'Q2' },
          {
            id: 'q3',
            type: 'yes_no',
            title: 'Happy with it?',
            logic: [{ if: { field: 'q3', op: 'equals', value: 'no' }, goTo: 'q2' }],
          },
          { id: 'q4', type: 'short_text', title: 'Q4' },
        ]),
      ),
    );
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.setAnswer('q3', 'no'));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('q2');
    act(() => result.current.next());
    act(() => result.current.setAnswer('q3', 'yes'));
    act(() => result.current.next());
    expect(result.current.currentQuestion?.id).toBe('q4');
  });
});

describe('Review lists the path navigation and the submit use (ENG-05)', () => {
  it('a jump testing Other on a hidden question skips the same question in Review', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'mode',
            type: 'single_choice',
            title: 'How?',
            prefillKey: 'mode',
            options: [
              { label: 'Pickup', value: 'pickup' },
              { label: 'Delivery', value: 'delivery' },
            ],
          },
          {
            id: 'pet',
            type: 'single_choice',
            title: 'Pet?',
            prefillKey: 'pet',
            allowOther: true,
            options: [
              { label: 'Dog', value: 'dog' },
              { label: 'Cat', value: 'cat' },
            ],
            visibleIf: { field: 'mode', op: 'equals', value: 'delivery' },
          },
          {
            id: 'q3',
            type: 'short_text',
            title: 'Q three?',
            logic: [{ if: { field: 'pet', op: 'equals', value: OTHER_VALUE }, goTo: 'q5' }],
          },
          { id: 'q4', type: 'short_text', title: 'Q four?', required: true },
          { id: 'q5', type: 'short_text', title: 'Q five?' },
          { id: 'check', type: 'review', title: 'Check your answers' },
        ])}
        onSubmit={onSubmit}
        prefill={{ mode: 'pickup', pet: 'Snake' }}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /pickup/i }));
    await typeIn(user, 'x');
    expect(await screen.findByText('Q five?')).toBeInTheDocument();
    await typeIn(user, 'y');
    // The Review step loads on demand: wait for its rows.
    expect(await screen.findByText('Q three?')).toBeInTheDocument();
    expect(screen.queryByText('Q four?')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs an answer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /looks good/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ mode: 'pickup', q3: 'x', q5: 'y' });
  });

  it('Review shows no step badge (ENG-09)', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Form
        schema={schemaOf([
          { id: 'name', type: 'short_text', title: 'Your name?' },
          { id: 'check', type: 'review', title: 'Check your answers' },
        ])}
        onSubmit={vi.fn()}
      />,
    );
    // The live question only; the outgoing copy laid over the stage keeps its badge.
    const badge = () =>
      container.querySelector('.slate-stage > .slate-stage-content .slate-step-badge');
    expect(badge()).not.toBeNull();
    await typeIn(user, 'Ann');
    expect(await screen.findByRole('button', { name: /looks good/i })).toBeInTheDocument();
    expect(badge()).toBeNull();
  });
});

describe('an advance from a step the path no longer holds', () => {
  it('Back to Review after an edit that changed the ending, then Looks good, goes to that ending', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf(
          [
            { id: 'name', type: 'short_text', title: 'Your name?' },
            {
              id: 'topics',
              type: 'multi_choice',
              title: 'Topics?',
              options: [
                { label: 'Apples', value: 'a' },
                { label: 'Bikes', value: 'b' },
              ],
              logic: [{ if: { field: 'topics', op: 'equals', value: 'b' }, goTo: 'sorry' }],
            },
            { id: 'check', type: 'review', title: 'Check your answers' },
          ],
          [{ id: 'sorry', type: 'thanks', title: 'Sorry, no bikes.' }],
        )}
        onSubmit={onSubmit}
      />,
    );
    await typeIn(user, 'Ann');
    await user.click(await screen.findByRole('checkbox', { name: /apples/i }));
    await user.click(screen.getByRole('button', { name: /^ok/i }));
    await user.click(await screen.findByRole('button', { name: /edit topics/i }));
    await user.click(await screen.findByRole('checkbox', { name: /bikes/i }));
    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(await screen.findByRole('button', { name: /looks good/i }));
    expect(await screen.findByText('Sorry, no bikes.')).toBeInTheDocument();
    expect(screen.queryByText('All set.')).not.toBeInTheDocument();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ name: 'Ann', topics: ['a', 'b'] });
  });
});

describe('the score counts only the answers that are sent (CON-07)', () => {
  it('an answer on a branch left behind adds nothing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <Form
        schema={schemaOf([
          {
            id: 'track',
            type: 'single_choice',
            title: 'Which track?',
            options: [
              { label: 'Track A', value: 'a' },
              { label: 'Track B', value: 'b' },
            ],
            logic: [{ if: { field: 'track', op: 'equals', value: 'a' }, goTo: 'q3' }],
          },
          {
            id: 'q2',
            type: 'single_choice',
            title: 'Q two?',
            options: [{ label: 'Five', value: 'five', score: 5 }],
          },
          {
            id: 'q3',
            type: 'single_choice',
            title: 'Q three?',
            options: [{ label: 'One', value: 'one', score: 1 }],
          },
        ])}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /track b/i }));
    await user.click(await screen.findByRole('radio', { name: /five/i }));
    expect(await screen.findByText('Q three?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(await screen.findByRole('button', { name: /back/i }));
    await user.click(await screen.findByRole('radio', { name: /track a/i }));
    await user.click(await screen.findByRole('radio', { name: /one/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ track: 'a', q3: 'one' });
    expect(onSubmit.mock.calls[0]![1].score).toBe(1);
  });
});
