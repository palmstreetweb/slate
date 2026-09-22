/**
 * Neon client for Slate admin (ADR-029).
 * VITE_NEON_URL = https://ep-….aws.neon.tech/neondb (not postgresql://).
 */

import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';
import type { Database } from './database.types.js';

/**
 * Derive Auth + Data API URLs from the single HTTPS database URL.
 * Matches Neon docs: host stays the same; Auth uses `.neonauth` + `/auth`,
 * Data API uses `.apirest` + `/rest/v1`.
 */
export function deriveNeonServiceUrls(baseUrl: string): {
  authUrl: string;
  dataApiUrl: string;
} {
  const u = new URL(baseUrl);
  const dbPath = u.pathname.replace(/\/$/, '') || '/neondb';
  // ep-xxx.us-east-2.aws.neon.tech → ep-xxx.neonauth.us-east-2.aws.neon.tech
  const host = u.hostname;
  const authHost = host.includes('.neonauth.')
    ? host
    : host.replace(/^([^.]+)\./, '$1.neonauth.');
  const dataHost = host.includes('.apirest.')
    ? host
    : host.replace(/^([^.]+)\./, '$1.apirest.');
  return {
    authUrl: `${u.protocol}//${authHost}${dbPath}/auth`,
    dataApiUrl: `${u.protocol}//${dataHost}${dbPath}/rest/v1`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- neon-js adapter generics are unstable across beta builds
export type NeonClient = any;

export function getNeonUrl(): string | undefined {
  return import.meta.env.VITE_NEON_URL?.trim() || undefined;
}

/** When `1` / `true`, ignore Neon — localStorage admin, no login (local UI testing). */
export function isAdminOfflineMode(): boolean {
  const raw = import.meta.env.VITE_ADMIN_OFFLINE;
  return raw === '1' || raw === 'true';
}

export function isNeonConfigured(): boolean {
  if (isAdminOfflineMode()) return false;
  return Boolean(getNeonUrl());
}

/** @deprecated Use isNeonConfigured */
export function isSupabaseConfigured(): boolean {
  return isNeonConfigured();
}

let client: NeonClient | null = null;

export function getNeon(): NeonClient {
  const url = getNeonUrl();
  if (!url) {
    throw new Error('Neon is not configured (VITE_NEON_URL)');
  }
  if (!client) {
    // Prefer the SDK's single-URL form so Auth + Data API hosts stay in sync
    // with neon-js defaults (critical for JWT → RLS).
    // allowAnonymous: public fill (`/forms/{slug}`) must call get_form_by_slug
    // without a signed-in user — SDK fetches a short-lived anonymous JWT.
    client = createClient<Database>(url, {
      auth: {
        adapter: SupabaseAuthAdapter(),
        allowAnonymous: true,
      },
    });
  }
  return client;
}

/** Public submit Neon Function URL. */
export function getSubmitUrl(): string {
  const fromEnv = import.meta.env.VITE_SUBMIT_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  throw new Error('VITE_SUBMIT_URL is not configured');
}

/** Presigned URL Neon Function for Object Storage. */
export function getStorageSignUrl(): string {
  const fromEnv = import.meta.env.VITE_STORAGE_SIGN_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  throw new Error('VITE_STORAGE_SIGN_URL is not configured');
}

export function hasStorageSignUrl(): boolean {
  return Boolean(import.meta.env.VITE_STORAGE_SIGN_URL?.trim());
}
