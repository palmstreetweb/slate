/**
 * Feedback send failures read as plain words (QA COPY-01 / S19), and the
 * offline studio never reaches the cloud to send one.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  configured: true,
  insert: vi.fn(),
  getNeon: vi.fn(),
}));

vi.mock('../examples/_admin/neon/env.js', () => ({
  isNeonConfigured: () => env.configured,
  getNeon: env.getNeon,
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ accessToken: 't', email: 'owner@example.com' }),
}));
vi.mock('../examples/_admin/neon/AuthProvider.js', () => ({
  useAuth: () => ({ user: { id: 'u_1', email: 'owner@example.com' } }),
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));

import { FeedbackButton } from '../examples/_admin/shell/FeedbackButton.js';
import { ToastProvider } from '../examples/_admin/toast.js';

async function send(note: string) {
  render(
    <ToastProvider>
      <FeedbackButton />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
  fireEvent.change(screen.getByPlaceholderText(/Any feedback/), { target: { value: note } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

beforeEach(() => {
  env.configured = true;
  env.insert.mockReset();
  env.getNeon.mockReset().mockReturnValue({ from: () => ({ insert: env.insert }) });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Feedback errors', () => {
  it('offline: one plain sentence, never “Failed to fetch”', async () => {
    env.insert.mockResolvedValue({
      error: {
        message: 'TypeError: Failed to fetch',
        details: 'TypeError: Failed to fetch\n at x',
        code: '',
      },
    });
    await send('The share button is hard to find');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t send — check your connection and try again.');
    expect(alert).not.toHaveTextContent(/TypeError|Failed to fetch/);
  });

  it('a thrown network error reads the same way', async () => {
    env.insert.mockRejectedValue(new TypeError('Failed to fetch'));
    await send('Love it');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t send — check your connection and try again.',
    );
  });

  it('a refused insert does not show Postgres wording', async () => {
    env.insert.mockResolvedValue({
      error: {
        code: '42501',
        message: 'new row violates row-level security policy for table "feedback"',
      },
    });
    await send('Love it');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your sign-in expired. Sign out and back in, then try again.');
    expect(alert).not.toHaveTextContent(/row-level|feedback"/);
  });

  it('the offline studio says it can’t send, without calling out', async () => {
    env.configured = false;
    await send('Hello');
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback isn’t available here.');
    expect(env.getNeon).not.toHaveBeenCalled();
  });
});
