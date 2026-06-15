/**
 * Hydrate remote stores on admin boot when Supabase is configured (ADR-028).
 */

import { isSupabaseConfigured } from './env.js';
import { hydrateFormsRemote } from './formsRemote.js';
import { hydrateSubmissionsRemote } from './submissionsRemote.js';

let hydrated = false;
let hydrating: Promise<void> | null = null;

export function isStoresHydrated(): boolean {
  return hydrated || !isSupabaseConfigured();
}

export function hydrateStores(): Promise<void> {
  if (!isSupabaseConfigured()) {
    hydrated = true;
    return Promise.resolve();
  }
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    await Promise.all([hydrateFormsRemote(), hydrateSubmissionsRemote()]);
    hydrated = true;
  })();
  return hydrating;
}
