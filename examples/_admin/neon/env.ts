/**
 * Neon client for Slate admin (ADR-029). Pure config lives in config.ts.
 */

import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';
import type { Database } from './database.types.js';
import { getNeonUrl } from './config.js';

export {
  deriveNeonServiceUrls,
  getNeonUrl,
  isAdminOfflineMode,
  isNeonConfigured,
  isSupabaseConfigured,
  getSubmitUrl,
  getStorageSignUrl,
  hasStorageSignUrl,
} from './config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- neon-js adapter generics are unstable across beta builds
export type NeonClient = any;

let client: NeonClient | null = null;

export function getNeon(): NeonClient {
  const url = getNeonUrl();
  if (!url) {
    throw new Error('Neon is not configured (VITE_NEON_URL)');
  }
  if (!client) {
    // Prefer the SDK's single-URL form so Auth + Data API hosts stay in sync
    // with neon-js defaults (critical for JWT → RLS).
    // No anonymous fallback. With it, a request sent while the session token
    // was still settling (right after Google sign-in) ran as `anonymous`, and
    // owner-only RLS answered "0 rows" instead of an error — an empty dashboard
    // or every card at 0 responses. Without it the SDK throws AuthRequiredError,
    // which the hydrate/save retries treat as "not ready yet". Every studio
    // caller signs in first; the public fill app does not use the SDK.
    client = createClient<Database>(url, {
      auth: {
        adapter: SupabaseAuthAdapter(),
      },
    });
  }
  return client;
}
