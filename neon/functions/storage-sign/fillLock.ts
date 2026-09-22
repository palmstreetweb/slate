/**
 * Public-fill password lock helpers (ADR-043). Pure — no DB, no Hono.
 * submit-response carries an identical copy (each Function deploys from its own folder).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session token a respondent holds after a correct password.
 * Same value as Postgres `encode(hmac(form_id, fill_password_hash, 'sha256'), 'hex')`.
 * Changing or removing the password changes the hash, which voids every old token.
 */
export function fillUnlockToken(formId: string, passwordHash: string): string {
  return createHmac('sha256', passwordHash).update(formId).digest('hex');
}

/** Timing-safe check. Anything missing or malformed is a plain `false`. */
export function isValidUnlockToken(
  formId: string,
  passwordHash: string,
  candidate: unknown,
): boolean {
  if (typeof candidate !== 'string' || !/^[0-9a-f]{64}$/.test(candidate)) return false;
  const expected = Buffer.from(fillUnlockToken(formId, passwordHash), 'hex');
  const given = Buffer.from(candidate, 'hex');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
