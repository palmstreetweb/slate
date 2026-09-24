/**
 * Hydrate remote stores on admin boot when Neon is configured (ADR-029).
 */

import { isNeonConfigured } from './env.js';
import { waitForAuthReady } from './ensureAuth.js';
import {
  bumpFormsRemoteGeneration,
  clearFormsRemoteCache,
  hydrateFormsRemote,
} from './formsRemote.js';
import {
  bumpSubmissionsRemoteGeneration,
  clearSubmissionsRemoteCache,
  hydrateSubmissionsRemote,
} from './submissionsRemote.js';

const HYDRATE_TIMEOUT_MS = 25_000;

let hydrated = false;
let hydrating: Promise<void> | null = null;
/** Bumps on each hydrate start so a superseded in-flight run can't clear state. */
let hydrateGeneration = 0;
/** Survives React StrictMode remounts — avoids double force-hydrate on boot. */
let adminSessionHydrated = false;
/** Whose forms the stores hold. A warm cache for another user is never reused. */
let hydratedUserId: string | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export function isStoresHydrated(): boolean {
  return hydrated || !isNeonConfigured();
}

/** With `userId`, true only when that user's data is what was hydrated. */
export function isAdminSessionHydrated(userId?: string | null): boolean {
  if (!adminSessionHydrated) return false;
  return userId === undefined || hydratedUserId === userId;
}

export function markAdminSessionHydrated(userId?: string | null): void {
  adminSessionHydrated = true;
  hydratedUserId = userId ?? null;
}

export function clearAdminSessionHydrated(): void {
  adminSessionHydrated = false;
  hydratedUserId = null;
}

/** Clear module caches — call on sign-out. */
export function clearRemoteStores(): void {
  clearFormsRemoteCache();
  clearSubmissionsRemoteCache();
  hydrated = false;
  hydrating = null;
  hydrateGeneration += 1;
  adminSessionHydrated = false;
  hydratedUserId = null;
}

/**
 * Load forms + submissions from Neon.
 * Rejects on failure — callers must NOT treat a failed hydrate as an empty library
 * (that made the dashboard look like forms were deleted).
 */
export function hydrateStores(opts?: { force?: boolean }): Promise<void> {
  if (!isNeonConfigured()) {
    hydrated = true;
    return Promise.resolve();
  }
  if (hydrated && !opts?.force) return Promise.resolve();
  if (hydrating && !opts?.force) return hydrating;

  if (opts?.force) {
    hydrated = false;
  }

  const generation = ++hydrateGeneration;
  // Invalidate in-flight remote applies (sign-out / force) without wiping warm cache.
  bumpFormsRemoteGeneration();
  bumpSubmissionsRemoteGeneration();

  hydrating = (async () => {
    try {
      // Settle auth once, then soft-fetch both stores (no nested empty-retry loops).
      const auth = await waitForAuthReady(4);
      if (!auth.ok) {
        throw new Error(
          'Signed in, but the database could not resolve your user id from the session. Sign out and back in, then try again.',
        );
      }
      await withTimeout(
        Promise.all([hydrateFormsRemote({ soft: true }), hydrateSubmissionsRemote({ soft: true })]),
        HYDRATE_TIMEOUT_MS,
        'Neon store hydrate',
      );
      if (generation !== hydrateGeneration) return;
      hydrated = true;
    } catch (err) {
      if (generation !== hydrateGeneration) return;
      hydrated = false;
      throw err;
    } finally {
      if (generation === hydrateGeneration) {
        hydrating = null;
      }
    }
  })();
  return hydrating;
}
