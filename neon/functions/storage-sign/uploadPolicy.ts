/**
 * Which anonymous public/ uploads storage-sign will presign (ADR-050). Pure — no DB, no Hono.
 * A form only lends out bucket space when its published schema asks for a file,
 * and never more per object than its roomiest file question (or the global cap).
 */

const MIB = 1024 * 1024;

/**
 * The server never enforces a per-question limit below this. The client checks
 * `maxSizeMb` on the picked file, then re-encodes photos to JPEG, which can land
 * a little over a sub-megabyte limit after the picker already said yes.
 */
const MIN_QUESTION_LIMIT_BYTES = MIB;

export type PublicUploadDecision =
  | { ok: true; maxBytes: number }
  | { ok: false; reason: 'no-file-question' }
  | { ok: false; reason: 'too-large'; maxBytes: number };

/**
 * Largest object any `file_upload` question in `schema` accepts, never above
 * `capBytes`. `null` when there is no file question — or no usable schema at all.
 * The sign request doesn't say which question it's for, so the roomiest one wins.
 */
export function fileUploadLimitBytes(schema: unknown, capBytes: number): number | null {
  const questions = (schema as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(questions)) return null;

  let limit: number | null = null;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const { type, maxSizeMb } = q as { type?: unknown; maxSizeMb?: unknown };
    if (type !== 'file_upload') continue;
    // Unset or nonsense (0, negative, a string) falls back to the cap, like the client's default.
    const own =
      typeof maxSizeMb === 'number' && Number.isFinite(maxSizeMb) && maxSizeMb > 0
        ? Math.max(Math.floor(maxSizeMb * MIB), MIN_QUESTION_LIMIT_BYTES)
        : capBytes;
    const bounded = Math.min(own, capBytes);
    limit = limit === null ? bounded : Math.max(limit, bounded);
  }
  return limit;
}

/** Decide one public/ upload of `contentLength` bytes against the form's published schema. */
export function decidePublicUpload(
  schema: unknown,
  contentLength: number,
  capBytes: number,
): PublicUploadDecision {
  const maxBytes = fileUploadLimitBytes(schema, capBytes);
  if (maxBytes === null) return { ok: false, reason: 'no-file-question' };
  // Written as a negation so a NaN on either side refuses instead of signing.
  if (!(contentLength <= maxBytes)) return { ok: false, reason: 'too-large', maxBytes };
  return { ok: true, maxBytes };
}
