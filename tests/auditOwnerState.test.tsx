/**
 * Audit fixes (2026-10-09), F6: on a shared computer the next owner doesn't
 * inherit the last one's Build with AI prompts or the bell's read state.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: string, session: unknown) => void;

const fake = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  listeners: [] as Listener[],
  forget: vi.fn(),
}));

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
vi.mock('../examples/_admin/neon/hydrate.js', () => ({ clearRemoteStores: () => {} }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: () => {} }));
vi.mock('../examples/_admin/ownerBrowserState.js', () => ({
  forgetOwnerBrowserState: fake.forget,
}));

import { AuthProvider, useAuth } from '../examples/_admin/neon/AuthProvider.js';
import {
  AI_DRAFT_KEY,
  AI_RECENT_PROMPTS_KEY,
  readRecentPrompts,
  rememberPrompt,
} from '../examples/_admin/ai/client.js';
import {
  KNOWN_FLOOR_KEY,
  KNOWN_KEY,
  UNREAD_KEY,
  readKnown,
  readUnread,
  setUnread,
  subscribeUnread,
  writeKnown,
} from '../examples/_admin/responses/unreadStore.js';

const sessionFor = (id: string) => ({
  access_token: `token-${id}`,
  user: { id, email: `${id}@example.com` },
});
const ok = (session: unknown) => ({ data: { session }, error: null });

let api: ReturnType<typeof useAuth>;
function Probe() {
  api = useAuth();
  return <p data-testid="state">{api.loading ? 'loading' : (api.user?.id ?? 'signed-out')}</p>;
}
const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  fake.getSession.mockReset();
  fake.signOut.mockReset();
  fake.listeners.length = 0;
  fake.forget.mockReset();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    replace: vi.fn(),
  } as unknown as Location);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('forgetOwnerBrowserState', () => {
  it('drops the AI prompts, the draft marker and the bell’s memory, nothing else', async () => {
    const { forgetOwnerBrowserState } = await vi.importActual<
      typeof import('../examples/_admin/ownerBrowserState.js')
    >('../examples/_admin/ownerBrowserState.js');
    rememberPrompt('A quote form for Palm Street Pools, 805 area');
    window.sessionStorage.setItem(AI_DRAFT_KEY, 'f_1');
    writeKnown(['r1', 'r2']);
    setUnread(['r1']);
    window.localStorage.setItem(KNOWN_FLOOR_KEY, '2026-10-01T00:00:00.000Z');
    window.localStorage.setItem('slate-theme', 'dark');
    const heard = vi.fn();
    const off = subscribeUnread(heard);

    forgetOwnerBrowserState();

    expect(readRecentPrompts()).toEqual([]);
    expect(window.localStorage.getItem(AI_RECENT_PROMPTS_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AI_DRAFT_KEY)).toBeNull();
    expect(readKnown()).toEqual([]);
    expect(readUnread()).toEqual([]);
    expect(window.localStorage.getItem(KNOWN_KEY)).toBeNull();
    expect(window.localStorage.getItem(UNREAD_KEY)).toBeNull();
    expect(window.localStorage.getItem(KNOWN_FLOOR_KEY)).toBeNull();
    expect(window.localStorage.getItem('slate-theme')).toBe('dark');
    expect(heard).toHaveBeenCalled();
    off();
    // The keys it names are the ones the AI client writes.
    expect(AI_RECENT_PROMPTS_KEY.startsWith('slate-ai-')).toBe(true);
    expect(AI_DRAFT_KEY).toBe('slate-ai-draft');
  });
});

describe('when the account changes (audit F6)', () => {
  async function signedInAs(id: string) {
    fake.getSession.mockResolvedValue(ok(sessionFor(id)));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(state()).toBe(id));
  }

  it('signing out forgets the owner’s browser state', async () => {
    await signedInAs('a');
    fake.signOut.mockResolvedValue({ error: null });
    await act(async () => {
      await api.signOut();
    });
    expect(fake.forget).toHaveBeenCalledTimes(1);
  });

  it('another tab signing out, or a switch to another account, forgets it too', async () => {
    await signedInAs('a');
    act(() => fake.listeners.forEach((l) => l('SIGNED_IN', sessionFor('b'))));
    expect(state()).toBe('b');
    expect(fake.forget).toHaveBeenCalledTimes(1);
    act(() => fake.listeners.forEach((l) => l('SIGNED_OUT', null)));
    expect(fake.forget).toHaveBeenCalledTimes(2);
  });

  it('the same owner refreshing a token keeps it', async () => {
    await signedInAs('a');
    act(() => fake.listeners.forEach((l) => l('TOKEN_REFRESHED', sessionFor('a'))));
    expect(fake.forget).not.toHaveBeenCalled();
  });
});
