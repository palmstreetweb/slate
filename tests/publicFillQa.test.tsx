import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * QA pass (w4a) on the public fill page, with the real engine and only the
 * network stubbed: a failed submit never says "all done" (GAPV-X1, COPY-02),
 * a too-long submit goes back to the long answer (GAP-07, F10), a form that
 * closed mid-fill shows the closed screen (COPY-02), a failed load can be
 * tried again (COPY-X3), and answers survive a reload in the same tab only
 * (GAP-05).
 */

const api = vi.hoisted(() => ({
  fetchPublishedFormBySlug: vi.fn(),
  unlockPublicForm: vi.fn(),
  submitPublicResponse: vi.fn(),
  fetchSlotsLeft: vi.fn(),
}));

vi.mock('../examples/_admin/neon/publicApi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof PublicApi>()),
  ...api,
}));
vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  getSubmitUrl: () => 'https://submit.invalid',
}));
vi.mock('../examples/_admin/shell/LoadingScreen.js', () => ({
  LoadingScreen: () => <p>loading</p>,
}));
vi.mock('../examples/_admin/hostFileUpload.js', () => ({ hostFileUpload: vi.fn() }));
vi.mock('../examples/_admin/resolveUploadMeta.js', () => ({ resolveUploadMeta: vi.fn() }));

import type * as PublicApi from '../examples/_admin/neon/publicApi.js';
import { PublicFill, longestAnswer } from '../examples/_admin/pages/PublicFill.js';
import { FormClosedError, TooLongError } from '../examples/_admin/neon/publicApi.js';
import {
  FORM_UNAVAILABLE,
  LOAD_OFFLINE,
  SEND_LATER,
  SEND_TOO_LONG_HERE,
} from '../examples/_admin/fillCopy.js';

const schema = {
  brand: { name: 'Roof check' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'name', type: 'short_text', title: 'Your name?', required: true },
    { id: 'story', type: 'long_text', title: 'Tell us about the job', required: true },
    { id: 'done', type: 'thanks', title: 'Thanks, all done.', subtitle: 'We’ll call you.' },
  ],
};

const open = { id: 'f_1', name: 'Roof check', slug: '48210378', locked: false, schema };

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  window.history.replaceState({}, '', '/forms/48210378');
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function fillBoth(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox'), 'Ada');
  await user.keyboard('{Enter}');
  const story = await screen.findByRole('textbox', {}, { timeout: 4000 });
  await user.type(story, 'The gutter leaks.');
  await user.click(screen.getByRole('button', { name: /^ok/i }));
}

describe('a failed submit (GAPV-X1, COPY-02)', () => {
  it('says “Not sent yet.” with the plain reason and Retry — never the thanks title', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse.mockRejectedValueOnce(new Error(SEND_LATER));
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await fillBoth(user);
    expect(await screen.findByRole('heading', { name: 'Not sent yet.' })).toBeInTheDocument();
    expect(screen.queryByText('Thanks, all done.')).toBeNull();
    expect(screen.queryByText('We’ll call you.')).toBeNull();
    expect(screen.getByText(SEND_LATER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('closed while answering (the Function’s 404): the closed screen, no Retry', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse.mockRejectedValueOnce(
      new FormClosedError('This form is closed.', { reason: 'date', message: null }),
    );
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await fillBoth(user);
    expect(await screen.findByText(/It closed before your answers were sent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('too long to send (GAP-07, F10)', () => {
  it('goes back to the longest answer with a plain sentence, every answer kept', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse
      .mockRejectedValueOnce(new TooLongError())
      .mockResolvedValueOnce({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await fillBoth(user);
    expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
      SEND_TOO_LONG_HERE,
    );
    expect(screen.getByRole('heading', { name: 'Tell us about the job' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('The gutter leaks.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('longestAnswer picks the biggest answer and says whether it is text', () => {
    expect(longestAnswer({ a: 'short', b: 'a much longer answer', c: ['x'] })).toEqual({
      id: 'b',
      text: true,
    });
    expect(longestAnswer({ a: 'x', grid: { r1: 'c1', r2: 'c2', r3: 'c3' } })).toEqual({
      id: 'grid',
      text: false,
    });
    expect(longestAnswer({})).toBeNull();
  });
});

describe('loading the form (COPY-X3)', () => {
  it('a failed load offers Try again, which really loads again', async () => {
    api.fetchPublishedFormBySlug
      .mockRejectedValueOnce(new Error(LOAD_OFFLINE))
      .mockResolvedValueOnce(open);
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    expect(await screen.findByText(LOAD_OFFLINE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Your name?' })).toBeInTheDocument();
    expect(api.fetchPublishedFormBySlug).toHaveBeenCalledTimes(2);
  });

  it('a form that isn’t there has no Try again (it can’t help)', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(null);
    render(<PublicFill slug="48210378" />);
    expect(await screen.findByText(FORM_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('same-tab resume (GAP-05)', () => {
  it('a reload in this tab offers the answers back; nothing is written to localStorage', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    const user = userEvent.setup();
    const first = render(<PublicFill slug="48210378" />);
    await user.type(await screen.findByRole('textbox'), 'Ada');
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: 'Tell us about the job' });
    expect(window.sessionStorage.getItem('slate-forms-resume:f_1')).toContain('Ada');
    expect(window.localStorage.getItem('slate-forms-resume:f_1')).toBeNull();
    first.unmount();

    render(<PublicFill slug="48210378" />);
    expect(await screen.findByText('Pick up where you left off?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(
      await screen.findByRole('heading', { name: 'Tell us about the job' }),
    ).toBeInTheDocument();
  });

  it('a successful submit clears the tab’s save', async () => {
    api.fetchPublishedFormBySlug.mockResolvedValue(open);
    api.submitPublicResponse.mockResolvedValueOnce({ id: 's_1' });
    const user = userEvent.setup();
    render(<PublicFill slug="48210378" />);
    await fillBoth(user);
    await screen.findByText('response received');
    await waitFor(() => expect(window.sessionStorage.getItem('slate-forms-resume:f_1')).toBeNull());
  });
});
