/**
 * Server-minted object keys (ADR-067). Pure — no DB, no S3.
 *
 * A key is `{scope}/{formId}/{uuid}/{name}`, the shape every stored ref, the
 * submit Function and the studio already read. The client still sends a path
 * of that shape (so an older storagesign keeps signing it), but a request that
 * names its question gets a fresh uuid and a cleaned name from the server: the
 * client can't pick, guess or reuse a key.
 */

import { randomUUID } from 'node:crypto';

/** The name part of a key: the characters the page's sanitizeFilename keeps, at most 120. */
export function safeUploadName(raw: string): string {
  const cleaned = raw.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
  // Nothing left, or only dots: not a usable name on anyone's disk.
  return /^[. ]*$/.test(cleaned) ? 'file' : cleaned;
}

export function mintUploadKey(scope: 'public' | 'draft', formId: string, name: string): string {
  return `${scope}/${formId}/${randomUUID()}/${safeUploadName(name)}`;
}

/** A question id as the sign request may carry it: 1–128 characters, no slash or control characters. */
export function isQuestionId(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length >= 1 &&
    v.length <= 128 &&
    // eslint-disable-next-line no-control-regex
    !/[/\u0000-\u001f\u007f]/.test(v) &&
    !(v in Object.prototype)
  );
}
