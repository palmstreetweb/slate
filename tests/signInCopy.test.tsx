/**
 * Sign-in errors in plain words (QA COPY-04): never "Invalid OTP", "OTP
 * expired", "Failed to fetch" or "HTTP 500 Internal Server Error".
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  magicLink: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock('../examples/_admin/neon/env.js', () => ({
  isNeonConfigured: () => true,
  getNeonUrl: () => 'https://ep-x.us-east-2.aws.neon.tech/neondb',
  deriveNeonServiceUrls: () => ({ authUrl: 'https://auth.example', dataApiUrl: '' }),
  getNeon: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOtp: fake.signInWithOtp,
      verifyOtp: fake.verifyOtp,
      signInWithOAuth: fake.signInWithOAuth,
      getBetterAuthInstance: () => ({ signIn: { magicLink: fake.magicLink } }),
    },
  }),
}));
vi.mock('../examples/_admin/neon/hydrate.js', () => ({ clearRemoteStores: () => {} }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));

import { AuthProvider, friendlyAuthError } from '../examples/_admin/neon/AuthProvider.js';
import { Login } from '../examples/_admin/pages/Login.js';

const RAW =
  /OTP|Failed to fetch|HTTP|Internal Server|Too many requests\.|Please|callbackURL|127\.0\.0\.1/;

beforeEach(() => {
  fake.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  fake.magicLink.mockReset().mockResolvedValue({ error: null });
  fake.verifyOtp.mockReset();
  fake.signInWithOAuth.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('friendlyAuthError', () => {
  it.each([
    ['Invalid OTP', 'verify', 'That code doesn’t match. Check the newest email and try again.'],
    [{ message: 'OTP expired', status: 400 }, 'verify', 'That code has expired. Send a new one.'],
    [
      { message: 'Too many attempts', status: 403 },
      'verify',
      'Too many tries with that code. Send a new one.',
    ],
    [
      new TypeError('Failed to fetch'),
      'send',
      'Can’t reach Slate. Check your connection and try again.',
    ],
    [
      new TypeError('Load failed'),
      'verify',
      'Can’t reach Slate. Check your connection and try again.',
    ],
    [
      { message: 'HTTP 500 Internal Server Error', status: 500 },
      'send',
      'We couldn’t send the sign-in email. Try again in a minute.',
    ],
    [
      { message: 'Too many requests. Please try again later.', status: 429 },
      'send',
      'Too many sign-in emails for now. Wait a few minutes, then try again.',
    ],
    [
      { message: 'Too many requests', status: 429 },
      'verify',
      'Too many tries for now. Wait a few minutes, then try again.',
    ],
    [
      'Invalid callbackURL',
      'send',
      'Sign-in doesn’t work on this address. Go to slateforms.vercel.app and sign in there.',
    ],
    [
      'HTTP 403',
      'send',
      'Sign-in doesn’t work on this address. Go to slateforms.vercel.app and sign in there.',
    ],
    [{ message: 'Invalid email', status: 400 }, 'send', 'Enter a valid email address.'],
    [
      { message: 'An unexpected error occurred', status: 500 },
      'google',
      'Google sign-in didn’t start. Try again in a minute.',
    ],
    [{ message: 'something new' }, 'verify', 'We couldn’t check that code. Try again in a minute.'],
  ] as const)('%j (%s)', (raw, step, expected) => {
    const text = friendlyAuthError(raw, step);
    expect(text).toBe(expected);
    expect(text).not.toMatch(RAW);
  });

  it('no error is no message', () => {
    expect(friendlyAuthError(null, 'send')).toBeNull();
    expect(friendlyAuthError(undefined, 'verify')).toBeNull();
  });
});

async function renderLogin() {
  await act(async () => {
    render(
      <AuthProvider>
        <Login />
      </AuthProvider>,
    );
  });
}

async function requestCode() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link and code' }));
  });
}

describe('the sign-in screen', () => {
  it('a wrong code reads as plain words', async () => {
    fake.verifyOtp.mockResolvedValue({ error: { message: 'Invalid OTP', status: 400 } });
    await renderLogin();
    await requestCode();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Sign-in code'), { target: { value: '123456' } });
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That code doesn’t match. Check the newest email and try again.',
    );
    expect(alert).not.toHaveTextContent(/OTP/);
  });

  it('a check that never left the device', async () => {
    fake.verifyOtp.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderLogin();
    await requestCode();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Sign-in code'), { target: { value: '123456' } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Can’t reach Slate. Check your connection and try again.',
    );
  });

  it('sending fails offline', async () => {
    fake.signInWithOtp.mockRejectedValue(new TypeError('Failed to fetch'));
    fake.magicLink.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderLogin();
    await requestCode();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Can’t reach Slate. Check your connection and try again.');
    expect(alert).not.toHaveTextContent(/Failed to fetch/);
  });

  it('sending hits the email limit', async () => {
    fake.signInWithOtp.mockResolvedValue({
      error: { message: 'Too many requests. Please try again later.', status: 429 },
    });
    fake.magicLink.mockResolvedValue({ error: { message: 'Too many requests', status: 429 } });
    await renderLogin();
    await requestCode();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many sign-in emails for now. Wait a few minutes, then try again.',
    );
  });

  it('Google offline', async () => {
    fake.signInWithOAuth.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderLogin();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Can’t reach Slate. Check your connection and try again.',
    );
  });
});
