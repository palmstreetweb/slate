/**
 * Shared sign-out flow: play word-dissolve overlay + letter-fall cue, then clear session.
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../neon/AuthProvider.js';
import { hasPendingFormWrites } from '../_formsStore.js';
import { useOptionalConfirm } from '../_confirm.js';
import { useToast } from '../toast.js';
import { playUiSound } from '../uiSounds.js';
import { SIGN_OUT_ANIM_MS, SignOutOverlay } from './SignOutOverlay.js';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Asked before a sign-out that would lose a write still on its way (audit B5). */
export const SIGN_OUT_UNSAVED = {
  title: 'Some changes aren’t saved yet',
  message:
    'Slate is still saving. Signing out now loses those changes — wait a moment and try again, or sign out anyway.',
  confirmLabel: 'Sign out anyway',
  cancelLabel: 'Wait',
} as const;

export function useSignOutFlow() {
  const { signOut } = useAuth();
  const toast = useToast();
  const confirm = useOptionalConfirm();
  const [leaving, setLeaving] = useState(false);

  const runSignOut = useCallback(async () => {
    if (leaving) return;
    if (confirm && hasPendingFormWrites()) {
      const ok = await confirm({ ...SIGN_OUT_UNSAVED, danger: true });
      if (!ok) return;
    }
    setLeaving(true);
    const quiet = prefersReducedMotion();
    if (!quiet) playUiSound('sign-out');
    const wait = quiet ? 0 : SIGN_OUT_ANIM_MS;
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, wait);
      });
    }
    // On success the page reloads to Login; only a failure comes back here.
    const { error } = await signOut();
    setLeaving(false);
    if (error) {
      toast.push({
        title: 'Still signed in',
        detail: error,
        tone: 'error',
        action: { label: 'Try again', onClick: () => void runSignOutRef.current() },
      });
    }
  }, [confirm, leaving, signOut, toast]);
  const runSignOutRef = useRef(runSignOut);
  runSignOutRef.current = runSignOut;

  const overlay = <SignOutOverlay open={leaving} />;

  return { runSignOut, leaving, overlay };
}
