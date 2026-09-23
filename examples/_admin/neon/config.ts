/**
 * Neon configuration that needs no SDK (ADR-048). The public fill app imports
 * only this file, so respondents never download @neondatabase/neon-js.
 * VITE_NEON_URL = https://ep-….aws.neon.tech/neondb (not postgresql://).
 */

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
  const authHost = host.includes('.neonauth.') ? host : host.replace(/^([^.]+)\./, '$1.neonauth.');
  const dataHost = host.includes('.apirest.') ? host : host.replace(/^([^.]+)\./, '$1.apirest.');
  return {
    authUrl: `${u.protocol}//${authHost}${dbPath}/auth`,
    dataApiUrl: `${u.protocol}//${dataHost}${dbPath}/rest/v1`,
  };
}

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
