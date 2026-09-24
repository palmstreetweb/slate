import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: string, session: unknown) => void;

const fake = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  listeners: [] as Array<(event: string, session: unknown) => void>,
}));
const clearRemoteStores = vi.hoisted(() => vi.fn());

vi.mock('../examples/_admin/neon/env.js', () => ({
  isNeonConfigured: () => true,
  getNeonUrl: () => 'https://ep-x.c-4.us-east-2.aws.neon.tech/neondb',
  deriveNeonServiceUrls: () => ({ authUrl: 'https://auth.example', dataApiUrl: '' }),
  getNeon: () => ({
    auth: {
      getSession: fake.getSession,
      signOut: fake.signOut,
      onAuthStateChange: (cb: Listener) => {
        fake.listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));
vi.mock('../examples/_admin/neon/hydrate.js', () => ({ clearRemoteStores }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));

import { AUTH_LOST_EVENT, AuthProvider, useAuth } from '../examples/_admin/neon/AuthProvider.js';

const sessionFor = (id: string) => ({
  access_token: `token-${id}`,
  user: { id, email: `${id}@example.com` },
});
const ok = (session: unknown) => ({ data: { session }, error: null });

let api: ReturnType<typeof useAuth>;
function Probe() {
  api = useAuth();
  return (
    <p data-testid="state">
      {api.loading
        ? 'loading'
        : api.authUnreachable
          ? 'unreachable'
          : (api.user?.id ?? 'signed-out')}
    </p>
  );
}
const state = () => screen.getByTestId('state').textContent;

let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fake.getSession.mockReset();
  fake.signOut.mockReset();
  fake.listeners.length = 0;
  clearRemoteStores.mockReset();
  replace = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    replace,
  } as unknown as Location);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('boot: unreachable is not signed out', () => {
  it('retries, then shows "unreachable" instead of Login, and recovers on retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.getSession.mockResolvedValue({ data: null, error: { status: 503 } });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    // An error-time null INITIAL_SESSION must not count as "signed out".
    act(() => fake.listeners.forEach((l) => l('INITIAL_SESSION', null)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(state()).toBe('unreachable');
    expect(fake.getSession).toHaveBeenCalledTimes(4);

    fake.getSession.mockResolvedValue(ok(sessionFor('a')));
    act(() => api.retryAuth());
    await waitFor(() => expect(state()).toBe('a'));
  });

  it('a clean "no session" answer is signed out', async () => {
    fake.getSession.mockResolvedValue(ok(null));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('signed-out'));
  });
});

describe('sign-out only counts when the server confirms', () => {
  beforeEach(() => fake.getSession.mockResolvedValue(ok(sessionFor('a'))));

  async function signedIn() {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('a'));
  }

  it('failure keeps the owner signed in and reports it', async () => {
    await signedIn();
    fake.signOut.mockResolvedValue({ error: { message: 'Failed to fetch' } });
    let result: { error: string | null } = { error: null };
    await act(async () => {
      result = await api.signOut();
    });
    expect(result.error).toMatch(/Couldn’t sign out/);
    expect(state()).toBe('a');
    expect(clearRemoteStores).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a thrown network error is a failure too', async () => {
    await signedIn();
    fake.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    let result: { error: string | null } = { error: null };
    await act(async () => {
      result = await api.signOut();
    });
    expect(result.error).not.toBeNull();
    expect(state()).toBe('a');
  });

  it('success clears every cache and reloads to Login', async () => {
    await signedIn();
    fake.signOut.mockResolvedValue({ error: null });
    await act(async () => {
      await api.signOut();
    });
    expect(clearRemoteStores).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('a late "signed in" event during sign-out cannot bring the account back', async () => {
    await signedIn();
    let finish: (v: unknown) => void = () => {};
    fake.signOut.mockReturnValue(new Promise((r) => (finish = r)));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = api.signOut();
    });
    act(() => fake.listeners.forEach((l) => l('SIGNED_IN', sessionFor('a'))));
    await act(async () => {
      finish({ error: null });
      await pending;
    });
    expect(state()).toBe('signed-out');
  });
});

describe('account changes never show the previous owner’s data', () => {
  it('another tab signing out clears the stores', async () => {
    fake.getSession.mockResolvedValue(ok(sessionFor('a')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('a'));
    act(() => fake.listeners.forEach((l) => l('SIGNED_OUT', null)));
    expect(state()).toBe('signed-out');
    expect(clearRemoteStores).toHaveBeenCalledTimes(1);
  });

  it('switching straight from A to B clears A’s stores first', async () => {
    fake.getSession.mockResolvedValue(ok(sessionFor('a')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('a'));
    act(() => fake.listeners.forEach((l) => l('SIGNED_IN', sessionFor('b'))));
    expect(state()).toBe('b');
    expect(clearRemoteStores).toHaveBeenCalledTimes(1);
  });

  it('the same user refreshing their token keeps the stores', async () => {
    fake.getSession.mockResolvedValue(ok(sessionFor('a')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('a'));
    act(() => fake.listeners.forEach((l) => l('TOKEN_REFRESHED', sessionFor('a'))));
    expect(clearRemoteStores).not.toHaveBeenCalled();
  });
});

describe('a session that drops mid-use', () => {
  it('goes to Login when the server says signed out', async () => {
    fake.getSession.mockResolvedValueOnce(ok(sessionFor('a')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('a'));
    fake.getSession.mockResolvedValue(ok(null));
    act(() => {
      window.dispatchEvent(new Event(AUTH_LOST_EVENT));
    });
    await waitFor(() => expect(state()).toBe('signed-out'));
  });

  it('stays put when the server just can’t be reached', async () => {
    fake.getSession.mockResolvedValueOnce(ok(sessionFor('a')));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe('a'));
    fake.getSession.mockResolvedValue({ data: null, error: { status: 0 } });
    await act(async () => {
      window.dispatchEvent(new Event(AUTH_LOST_EVENT));
      await Promise.resolve();
    });
    expect(state()).toBe('a');
  });
});
