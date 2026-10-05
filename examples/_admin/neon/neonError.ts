/**
 * Neon / PostgREST errors are often plain objects, not `Error` instances —
 * so `err instanceof Error` hid the real message behind "Could not save form".
 *
 * Two jobs, kept apart (QA COPY-01, S20):
 * - `formatNeonError` is the RAW text, for console.error and for spotting auth
 *   failures. It can hold a stack trace, Postgres wording or an HTML page.
 * - `userNeonError` is what an owner reads: one plain sentence picked by the
 *   kind of failure. It never includes details, hints, codes or bodies.
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
    // The SDK's AuthRequiredError: no session token yet (no anonymous fallback).
    msg.includes('authentication required') ||
    msg.includes('unauthorized')
  );
}

export function isQuotaExceededError(err: unknown): boolean {
  return quotaFromUnknown(err) !== null;
}

/**
 * The Data API has no session to send (ensureAuth.ts) or the database can't
 * tell who the session belongs to (hydrate). Thrown with plain words; the
 * studio retries these quietly while sign-in settles.
 */
export class SessionNotReadyError extends Error {
  constructor(message = 'You’ve been signed out. Sign in again to keep working.') {
    super(message);
    this.name = 'SessionNotReadyError';
  }
}

export function isSessionNotReadyError(err: unknown): boolean {
  return (
    err instanceof SessionNotReadyError ||
    (Boolean(err) &&
      typeof err === 'object' &&
      (err as { name?: unknown }).name === 'SessionNotReadyError')
  );
}

export type NeonFailure = 'quota' | 'offline' | 'signed-out' | 'conflict' | 'server' | 'other';

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** What kind of failure this is, from whatever shape the SDK handed back. */
export function neonFailureKind(err: unknown): NeonFailure {
  if (quotaFromUnknown(err)) return 'quota';
  const e = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const raw = formatNeonError(err, '');
  const name = typeof e.name === 'string' ? e.name : '';
  // postgrest-js turns a failed fetch into { message: 'TypeError: Failed to fetch', code: '' }.
  // A load that runs out of time (hydrate.ts) is almost always the connection too.
  if (
    err instanceof TypeError ||
    name === 'TypeError' ||
    name === 'TimeoutError' ||
    status === 0 ||
    /failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet|err_network|internet connection/i.test(
      raw,
    )
  ) {
    return 'offline';
  }
  const signedOut =
    isSessionNotReadyError(err) || isRlsOrAuthError(err) || /^PGRST30[0-3]$/.test(code);
  // No session to send while the device is offline is a connection problem.
  if (signedOut) return isOffline() ? 'offline' : 'signed-out';
  if (code === '23505' || status === 409 || /duplicate key/i.test(raw)) return 'conflict';
  if (
    /^PGRST00[0-3]$/.test(code) ||
    code === '57014' ||
    code === '53300' ||
    code.startsWith('08') ||
    (status !== undefined && status >= 500) ||
    /<html|<!doctype|service (temporarily )?unavailable|bad gateway|gateway time-?out|internal server error|timed out|timeout|upstream|\b50[0-4]\b/i.test(
      raw,
    )
  ) {
    return 'server';
  }
  if (isOffline()) return 'offline';
  return 'other';
}

/** Which studio action failed — the words change with it. */
export type NeonAction =
  | 'save'
  /** Trash, restore, delete: a one-off the owner can simply repeat. */
  | 'delete'
  | 'load'
  | 'password'
  | 'response'
  | 'move'
  | 'feedback'
  | 'restore-backup';

const SIGNED_OUT = 'Your sign-in expired. Sign out and back in, then try again.';
const SERVER = 'Slate is having trouble right now. Try again in a minute.';

/**
 * save, delete, response, move and restore-backup appear under a toast title
 * that already says what failed ("Couldn’t save your form"), so they say what
 * to do. load, password and feedback stand alone, so they say both.
 */
const OFFLINE: Record<NeonAction, string> = {
  save: 'Check your connection. Your last change isn’t saved yet.',
  delete: 'Check your connection and try again.',
  load: 'Couldn’t load your forms — check your connection, then try again.',
  password: 'Couldn’t change the password — check your connection and try again.',
  response: 'Check your connection and try again.',
  move: 'Check your connection and try again.',
  feedback: 'Couldn’t send — check your connection and try again.',
  'restore-backup': 'Check your connection, then restore the backup again.',
};

const OTHER: Record<NeonAction, string> = {
  save: 'Your last change isn’t saved yet. Try again in a moment.',
  delete: 'Try again in a moment.',
  load: 'Couldn’t load your forms. Try again in a moment.',
  password: 'Couldn’t change the password. Try again in a moment.',
  response: 'Try again in a moment.',
  move: 'Try again in a moment.',
  feedback: 'Couldn’t send your note. Try again in a moment.',
  'restore-backup': 'Restore the backup again in a moment.',
};

/**
 * One plain sentence for an owner. Logs nothing: callers keep the raw error in
 * console.error (formatNeonError) for debugging.
 */
export function userNeonError(err: unknown, action: NeonAction): string {
  const kind = neonFailureKind(err);
  switch (kind) {
    case 'quota':
      return formQuotaUserMessage(quotaFromUnknown(err)!);
    case 'offline':
      return OFFLINE[action];
    case 'signed-out':
      return action === 'load'
        ? 'Slate couldn’t confirm it’s you. Try again, or sign out and back in.'
        : SIGNED_OUT;
    case 'conflict':
      return action === 'save'
        ? 'This form changed somewhere else. Reload the page and try again.'
        : 'Something changed at the same time. Reload the page and try again.';
    case 'server':
      return SERVER;
    default:
      return OTHER[action];
  }
}
