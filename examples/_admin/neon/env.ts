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
    // allowAnonymous: studio code paths that run before sign-in (e.g. an owner
    // previewing their own public link) still get a short-lived anonymous JWT.
    // The public fill app itself does not use the SDK (see publicForm.ts).
    client = createClient<Database>(url, {
      auth: {
        adapter: SupabaseAuthAdapter(),
        allowAnonymous: true,
      },
    });
  }
  return client;
}
