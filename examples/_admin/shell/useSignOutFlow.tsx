/**
 * Shared sign-out flow: play word-dissolve overlay + letter-fall cue, then clear session.
 */

'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '../neon/AuthProvider.js';
import { playUiSound } from '../uiSounds.js';
import { SIGN_OUT_ANIM_MS, SignOutOverlay } from './SignOutOverlay.js';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSignOutFlow() {
  const { signOut } = useAuth();
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
    try {
      await signOut();
    } finally {
      setLeaving(false);
    }
  }, [leaving, signOut]);

  const overlay = <SignOutOverlay open={leaving} />;

  return { runSignOut, leaving, overlay };
}
