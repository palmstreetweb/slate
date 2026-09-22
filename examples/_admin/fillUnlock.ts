/**
 * Respondent-side unlock token for password-locked forms (ADR-043).
 * sessionStorage only: survives a reload in this tab, gone when the tab closes.
 * Holds the server-minted token — never the password.
 */

const KEY_PREFIX = 'slate-fill-unlock:';
const TOKEN_RE = /^[0-9a-f]{64}$/;

export function fillUnlockKey(formId: string): string {
  return `${KEY_PREFIX}${formId}`;
}

export function readFillUnlockToken(formId: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(fillUnlockKey(formId));
    return raw && TOKEN_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeFillUnlockToken(formId: string, token: string): void {
  if (!TOKEN_RE.test(token)) return;
  try {
    window.sessionStorage.setItem(fillUnlockKey(formId), token);
  } catch {
    // Private mode / storage off — they just retype after a reload.
  }
}

export function clearFillUnlockToken(formId: string): void {
  try {
    window.sessionStorage.removeItem(fillUnlockKey(formId));
  } catch {
    // ignore
  }
}
