'use client';

import { useAuth } from '../neon/AuthProvider.js';
import { isNeonConfigured } from '../neon/env.js';

export function SignOutButton() {
  const cloud = isNeonConfigured();
  const { signOut, user } = useAuth();

  if (!cloud) return null;

  return (
    <button
      type="button"
      className="slate-btn slate-btn--ghost slate-btn--compact"
      onClick={() => void signOut()}
      title={user?.email ? `Sign out (${user.email})` : 'Sign out'}
    >
      Sign out
    </button>
  );
}
