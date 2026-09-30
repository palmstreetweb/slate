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
 * An old page's sign request doesn't say which question it's for, so the
 * roomiest one wins; a new one names its question (decideQuestionUpload, ADR-067).
 */
export function fileUploadLimitBytes(schema: unknown, capBytes: number): number | null {
  const questions = (schema as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(questions)) return null;

  let limit: number | null = null;
  for (const q of questions) {
    const own = questionLimitBytes(q, capBytes);
    if (own === null) continue;
    limit = limit === null ? own : Math.max(limit, own);
  }
  return limit;
}

/**
 * One question's own limit: a file upload's `maxSizeMb`, a voice note's
 * length, a checklist photo's 12 MB, never above `capBytes`. `null` for
 * anything that doesn't take files.
 */
export function questionLimitBytes(q: unknown, capBytes: number): number | null {
  if (!q || typeof q !== 'object') return null;
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
    return null;
  }
  return Math.min(own, capBytes);
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

/**
 * ADR-067: the sign request names its question, so the limit is that
 * question's own (ADR-050's deferred alternative). A question that isn't in
 * the published schema, or doesn't take files, lends nothing — the same answer
 * as a form with no file question. The last question with the id wins, as in
 * the submit Function's map.
 */
export function decideQuestionUpload(
  schema: unknown,
  questionId: string,
  contentLength: number,
  capBytes: number,
): PublicUploadDecision {
  const questions = (schema as { questions?: unknown } | null | undefined)?.questions;
  let q: unknown;
  if (Array.isArray(questions)) {
    for (const x of questions) {
      if (x && typeof x === 'object' && (x as { id?: unknown }).id === questionId) q = x;
    }
  }
  const maxBytes = questionLimitBytes(q, capBytes);
  if (maxBytes === null) return { ok: false, reason: 'no-file-question' };
  if (!(contentLength <= maxBytes)) return { ok: false, reason: 'too-large', maxBytes };
  return { ok: true, maxBytes };
}
