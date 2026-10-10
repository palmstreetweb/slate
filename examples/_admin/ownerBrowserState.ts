/**
 * What one owner leaves in this browser besides the stores: their Build with
 * AI prompts (business details) and which responses the bell has seen. On a
 * shared computer the next owner must not inherit them, so sign-out and any
 * change of account forget them (audit F6). Keys are named here, not imported,
 * so the auth layer doesn't pull the AI client and its dependencies.
 */

import { clearReadState } from './responses/unreadStore.js';

/** Every localStorage key that starts with this is one owner's own. */
export const OWNER_LOCAL_PREFIX = 'slate-ai-';
/** The Build with AI draft marker lives in sessionStorage. */
export const OWNER_SESSION_KEYS = ['slate-ai-draft'] as const;

export function forgetOwnerBrowserState(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(OWNER_LOCAL_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // blocked storage
  }
  try {
    for (const key of OWNER_SESSION_KEYS) window.sessionStorage.removeItem(key);
  } catch {
    // blocked storage
  }
  clearReadState();
}
