/**
 * Which anonymous public/ uploads storage-sign will presign (ADR-050). Pure — no DB, no Hono.
 * A form only lends out bucket space when its published schema asks for a file,
 * and never more per object than its roomiest file question (or the global cap).
 *
 * Wave C (ADR-065): a voice note and a photo checklist ask for files too. A
 * voice note's limit follows its length cap (`voiceMaxBytes`); a checklist
 * photo's is `PHOTO_MAX_BYTES`. Both mirror src/logic/media.ts (a test
 * compares them).
 */

const MIB = 1024 * 1024;

/**
 * The server never enforces a per-question limit below this. The client checks
 * `maxSizeMb` on the picked file, then re-encodes photos to JPEG, which can land
 * a little over a sub-megabyte limit after the picker already said yes.
 */
const MIN_QUESTION_LIMIT_BYTES = MIB;

/** Mirrors src/logic/media.ts: the biggest file a recording of `seconds` may be. */
export function voiceMaxBytes(seconds: number): number {
  return Math.max(MIB, Math.round(seconds) * 40_000 + 64 * 1024);
}

/** Mirrors src/logic/media.ts: the largest photo one checklist item uploads. */
export const PHOTO_MAX_BYTES = 12 * MIB;

/** Mirrors src/logic/media.ts voiceMaxSeconds: 5–300 s, default 60. */
function voiceSeconds(maxSeconds: unknown): number {
  if (typeof maxSeconds !== 'number' || !Number.isFinite(maxSeconds)) return 60;
  return Math.min(300, Math.max(5, Math.round(maxSeconds)));
}

export type PublicUploadDecision =
  | { ok: true; maxBytes: number }
  | { ok: false; reason: 'no-file-question' }
  | { ok: false; reason: 'too-large'; maxBytes: number };

/**
 * Largest object any file-taking question in `schema` accepts (a file upload,
 * a voice note or a photo checklist), never above
 * `capBytes`. `null` when there is no file question — or no usable schema at all.
 * The sign request doesn't say which question it's for, so the roomiest one wins.
 */
export function fileUploadLimitBytes(schema: unknown, capBytes: number): number | null {
  const questions = (schema as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(questions)) return null;

  let limit: number | null = null;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const { type, maxSizeMb, maxSeconds } = q as {
      type?: unknown;
      maxSizeMb?: unknown;
      maxSeconds?: unknown;
    };
    let own: number;
    if (type === 'file_upload') {
      // Unset or nonsense (0, negative, a string) falls back to the cap, like the client's default.
      own =
        typeof maxSizeMb === 'number' && Number.isFinite(maxSizeMb) && maxSizeMb > 0
          ? Math.max(Math.floor(maxSizeMb * MIB), MIN_QUESTION_LIMIT_BYTES)
          : capBytes;
    } else if (type === 'voice_note') {
      own = voiceMaxBytes(voiceSeconds(maxSeconds));
    } else if (type === 'photo_checklist') {
      own = PHOTO_MAX_BYTES;
    } else {
      continue;
    }
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
