/**
 * Shared sign-out flow: play word-dissolve overlay + letter-fall cue, then clear session.
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../neon/AuthProvider.js';
import { useToast } from '../toast.js';
import { playUiSound } from '../uiSounds.js';
import { SIGN_OUT_ANIM_MS, SignOutOverlay } from './SignOutOverlay.js';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSignOutFlow() {
  const { signOut } = useAuth();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);

  const runSignOut = useCallback(async () => {
    if (leaving) return;
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
  }, [leaving, signOut, toast]);
  const runSignOutRef = useRef(runSignOut);
  runSignOutRef.current = runSignOut;

  const overlay = <SignOutOverlay open={leaving} />;

  return { runSignOut, leaving, overlay };
}
