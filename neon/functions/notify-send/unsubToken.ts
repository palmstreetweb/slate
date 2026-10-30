/**
 * Signed unsubscribe tokens for response emails (ADR-072).
 *
 * `{formId}.{sig}`: sig is HMAC-SHA256(UNSUB_SECRET, "unsub:v1:" + formId), base64url. A form never
 * changes owner, so the form id is all the token needs to bind; checking it costs no database read,
 * and a forged or truncated token is refused before anything is touched. The token only ever turns
 * emails OFF, so a leaked one can do no more than its own unsubscribe link already does.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The storage-sign path class: every id the app mints (f_ + 12 chars) fits. */
const FORM_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;
/** Below this the secret is guessable; the Function refuses to sign or check with it. */
export const MIN_SECRET_LENGTH = 32;

function sigOf(secret: string, formId: string): string {
  return createHmac('sha256', secret).update(`unsub:v1:${formId}`).digest('base64url');
}

export function unsubToken(secret: string, formId: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('UNSUB_SECRET is too short');
  if (!FORM_ID_RE.test(formId)) throw new Error('bad form id');
  return `${formId}.${sigOf(secret, formId)}`;
}

/** The form id the token was signed for, or null. Never throws. */
export function verifyUnsubToken(secret: string, token: unknown): string | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) return null;
  if (typeof token !== 'string' || token.length > 120) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const formId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!FORM_ID_RE.test(formId) || !SIG_RE.test(sig)) return null;
  const want = Buffer.from(sigOf(secret, formId));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return formId;
}
