/**
 * Review fixes of 2026-10-05, save-and-resume (ADR-017 addendum, ADR-069):
 * one fill id across a reload and Resume, so a submit whose reply was lost is
 * never stored twice (ENG-03, SEC-1); a tab's save that has sat for 30
 * minutes isn't offered to the next person at a shared device (SEC-2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, defineSchema } from '@/index.js';
import type { SubmitMeta } from '@/index.js';

const KEY = 'slate-forms-resume:tabform';

const schema = defineSchema({
  id: 'tabform',
  brand: { name: 'Test' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', required: true },
    {
      id: 'size',
      type: 'single_choice',
      title: 'Which size?',
      options: [
        { label: 'Small', value: 's' },
        { label: 'Large', value: 'l' },
      ],
    },
    { id: 'done', type: 'thanks', title: 'Done!' },
  ],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function answerBoth(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox'), 'Ann{Enter}');
  await user.click(await screen.findByRole('radio', { name: /large/i }));
}

const metaOf = (fn: ReturnType<typeof vi.fn>, call: number) => fn.mock.calls[call]![1] as SubmitMeta;

describe('one fill id across a reload (ENG-03, SEC-1)', () => {
  it('a submit whose reply was lost, then a reload and Resume, sends the same fill again', async () => {
    const user = userEvent.setup();
    const lost = vi.fn().mockRejectedValue(new Error('We couldn’t reach Slate.'));
    const first = render(<Form schema={schema} resume="tab" onSubmit={lost} />);
    await answerBoth(user);
    await waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    const fillId = metaOf(lost, 0).fillId;
    expect(fillId).toMatch(UUID);
    first.unmount();

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} resume="tab" onSubmit={onSubmit} />);
    await user.click(await screen.findByRole('button', { name: /^resume$/i }));
    await user.click(await screen.findByRole('radio', { name: /large/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0]).toEqual({ name: 'Ann', size: 'l' });
    expect(metaOf(onSubmit, 0).fillId).toBe(fillId);
  });

  it('a reload while the submit is still on its way sends the same fill again', async () => {
    const user = userEvent.setup();
    const pending = vi.fn(() => new Promise<void>(() => {}));
    const first = render(<Form schema={schema} resume="tab" onSubmit={pending} />);
    await answerBoth(user);
    await waitFor(() => expect(pending).toHaveBeenCalledTimes(1));
    const fillId = metaOf(pending, 0).fillId;
    first.unmount();

    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} resume="tab" onSubmit={onSubmit} />);
    await user.click(await screen.findByRole('button', { name: /^resume$/i }));
    await user.click(await screen.findByRole('radio', { name: /large/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(metaOf(onSubmit, 0).fillId).toBe(fillId);
  });

  it('Retry keeps the fill; Start over and “Submit another” start a new one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Not sent.'))
      .mockResolvedValue(undefined);
    const first = render(<Form schema={schema} resume="tab" onSubmit={onSubmit} />);
    await answerBoth(user);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const fillId = metaOf(onSubmit, 0).fillId;
    expect(metaOf(onSubmit, 1).fillId).toBe(fillId);
    // Sent: the save is gone, and the next fill is a new one.
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toBeNull());
    await user.click(await screen.findByRole('button', { name: /submit another/i }));
    await answerBoth(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(metaOf(onSubmit, 2).fillId).toMatch(UUID);
    expect(metaOf(onSubmit, 2).fillId).not.toBe(fillId);
    first.unmount();

    // A save left by someone else, then Start over: a new fill, not theirs.
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        answers: { name: 'Bea' },
        step: 1,
        visitedIds: ['name'],
        fill: fillId,
        savedAt: new Date().toISOString(),
      }),
    );
    const next = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} resume="tab" onSubmit={next} />);
    await user.click(await screen.findByRole('button', { name: /start over/i }));
    await answerBoth(user);
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(metaOf(next, 0).fillId).toMatch(UUID);
    expect(metaOf(next, 0).fillId).not.toBe(fillId);
  });

  it('where the browser can’t make an id, the meta has none and nothing breaks', async () => {
    vi.stubGlobal('crypto', {});
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<Form schema={schema} onSubmit={onSubmit} />);
    await answerBoth(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(metaOf(onSubmit, 0).fillId).toBeUndefined();
  });
});

describe('a tab’s save lasts 30 minutes without an answer (SEC-2)', () => {
  const save = (minutesAgo: number) =>
    JSON.stringify({
      answers: { name: 'Ada' },
      step: 1,
      visitedIds: ['name'],
      savedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });

  it('an older one is never offered, and is deleted', async () => {
    window.sessionStorage.setItem(KEY, save(31));
    render(<Form schema={schema} resume="tab" onSubmit={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Your name?' })).toBeInTheDocument();
    expect(screen.queryByText('Pick up where you left off?')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a recent one is offered, with Start over', async () => {
    window.sessionStorage.setItem(KEY, save(29));
    render(<Form schema={schema} resume="tab" onSubmit={vi.fn()} />);
    expect(await screen.findByText('Pick up where you left off?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
  });

  it('one with no time we can read is not offered', async () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ answers: { name: 'Ada' }, step: 1, visitedIds: ['name'] }),
    );
    render(<Form schema={schema} resume="tab" onSubmit={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Your name?' });
    expect(screen.queryByText('Pick up where you left off?')).toBeNull();
  });

  it('a save across visits (`resume`, localStorage) keeps ADR-017’s rule: no time limit', async () => {
    window.localStorage.setItem(KEY, save(60 * 24 * 3));
    render(<Form schema={schema} resume onSubmit={vi.fn()} />);
    expect(await screen.findByText('Pick up where you left off?')).toBeInTheDocument();
  });
});
