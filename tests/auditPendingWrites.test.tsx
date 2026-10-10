/**
 * Audit fixes (2026-10-09), studio B5: a form write still on its way to the
 * server is not lost without a word — closing the tab asks, and Sign out asks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  pending: false,
  signOut: vi.fn(async () => ({ error: null as string | null })),
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  hasPendingFormWrites: () => state.pending,
}));
vi.mock('../examples/_admin/neon/AuthProvider.js', () => ({
  useAuth: () => ({ signOut: state.signOut }),
}));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));

import {
  LEAVE_WITH_PENDING_WRITES,
  usePendingWritesGuard,
} from '../examples/_admin/shell/usePendingWritesGuard.js';
import { SIGN_OUT_UNSAVED, useSignOutFlow } from '../examples/_admin/shell/useSignOutFlow.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';

function SignOut() {
  const { runSignOut, overlay } = useSignOutFlow();
  return (
    <>
      {overlay}
      <button type="button" onClick={() => void runSignOut()}>
        Sign out
      </button>
    </>
  );
}

beforeEach(() => {
  state.pending = false;
  state.signOut.mockClear();
  // Reduced motion: the flow skips its animation wait.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('leaving the page (audit B5)', () => {
  it('asks only while a write is pending', () => {
    renderHook(() => usePendingWritesGuard());
    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);

    state.pending = true;
    const held = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    expect(LEAVE_WITH_PENDING_WRITES).toMatch(/aren’t saved yet/);
  });

  it('stops asking once the hook is gone', () => {
    const { unmount } = renderHook(() => usePendingWritesGuard());
    unmount();
    state.pending = true;
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('Sign out with a write pending (audit B5)', () => {
  it('asks first; Wait keeps the owner signed in, Sign out anyway goes ahead', async () => {
    const user = userEvent.setup();
    state.pending = true;
    render(
      <ConfirmProvider>
        <SignOut />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(SIGN_OUT_UNSAVED.title);
    expect(dialog.textContent).toContain('Signing out now loses those changes');
    await user.click(screen.getByRole('button', { name: 'Wait' }));
    expect(state.signOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out anyway' }));
    expect(state.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out at once when nothing is pending', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <SignOut />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(state.signOut).toHaveBeenCalledTimes(1);
  });
});
