/**
 * Neon / PostgREST errors are often plain objects, not `Error` instances —
 * so `err instanceof Error` hid the real message behind "Could not save form".
 */

import { formQuotaUserMessage, quotaFromUnknown } from '../formQuota.js';

export function formatNeonError(err: unknown, fallback: string): string {
  const quota = quotaFromUnknown(err);
  if (quota) return formQuotaUserMessage(quota);
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim());
    if (parts.length) return parts.join(' — ');
    if (typeof e.code === 'string' && e.code) return `${fallback} (${e.code})`;
  }
  return fallback;
}

export function isRlsOrAuthError(err: unknown): boolean {
  const msg = formatNeonError(err, '').toLowerCase();
  return (
    msg.includes('row-level security') ||
    msg.includes('rls') ||
    msg.includes('permission denied') ||
    msg.includes('42501') ||
    msg.includes('jwt') ||
    msg.includes('not authenticated') ||
    msg.includes('unauthorized')
  );
}

export function isQuotaExceededError(err: unknown): boolean {
  return quotaFromUnknown(err) !== null;
}
