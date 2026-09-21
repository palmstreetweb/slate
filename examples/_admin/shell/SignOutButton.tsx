'use client';

import { useSignOutFlow } from './useSignOutFlow.js';
import { isNeonConfigured } from '../neon/env.js';
import { useAuth } from '../neon/AuthProvider.js';

export function SignOutButton() {
  const cloud = isNeonConfigured();
  const { user } = useAuth();
  const { runSignOut, leaving, overlay } = useSignOutFlow();

  if (!cloud) return null;

  return (
    <>
      {overlay}
      <button
        type="button"
        className="slate-btn slate-btn--ghost slate-btn--compact"
        onClick={() => void runSignOut()}
        disabled={leaving}
        title={user?.email ? `Sign out (${user.email})` : 'Sign out'}
      >
        {leaving ? 'Signing out…' : 'Sign out'}
      </button>
    </>
  );
}
