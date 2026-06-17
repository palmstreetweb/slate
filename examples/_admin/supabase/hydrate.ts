/**
 * Hydrate remote stores on admin boot when Supabase is configured (ADR-028).
 */

import { isSupabaseConfigured } from './env.js';
import { clearFormsRemoteCache, hydrateFormsRemote } from './formsRemote.js';
import {
  clearSubmissionsRemoteCache,
  hydrateSubmissionsRemote,
} from './submissionsRemote.js';

const HYDRATE_TIMEOUT_MS = 12_000;

let hydrated = false;
let hydrating: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export function isStoresHydrated(): boolean {
  return hydrated || !isSupabaseConfigured();
}

/** Clear module caches — call on sign-out. */
export function clearRemoteStores(): void {
  clearFormsRemoteCache();
  clearSubmissionsRemoteCache();
  hydrated = false;
  hydrating = null;
}

export function hydrateStores(opts?: { force?: boolean }): Promise<void> {
  if (!isSupabaseConfigured()) {
    hydrated = true;
    return Promise.resolve();
  }
  if (hydrated && !opts?.force) return Promise.resolve();
  if (hydrating && !opts?.force) return hydrating;

  if (opts?.force) {
    hydrated = false;
    hydrating = null;
  }

  hydrating = (async () => {
    try {
      await withTimeout(
        Promise.all([hydrateFormsRemote(), hydrateSubmissionsRemote()]),
        HYDRATE_TIMEOUT_MS,
        'Supabase store hydrate',
      );
    } catch (err) {
      console.warn('[slate] Remote hydrate failed — continuing with empty cache.', err);
    }
    hydrated = true;
    hydrating = null;
  })();
  return hydrating;
}
