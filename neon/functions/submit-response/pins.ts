/**
 * Pin-the-spot answers, server side (ADR-065). Keeps only pins the engine
 * could have written (x,y in 0–1, at most 4 decimals), at most the published
 * question's limit, notes trimmed and capped (dropped when notes are off),
 * and stamps the key of the published photo.
 *
 * The section below is a byte-for-byte copy of the shared section of
 * src/logic/pins.ts. tests/pins.test.ts fails if the two drift.
 */

/* ---------- shared with the server (keep identical) ---------- */

/** The most pins a question can ask for. */
export const PINS_MAX = 10;
/** Pins when the owner doesn't say. */
export const PINS_DEFAULT = 3;
/** Longest note on one pin, in characters. */
export const PIN_NOTE_MAX = 140;

const PIN_RE = /^(0(?:\.\d{1,4})?|1(?:\.0{1,4})?),(0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/;

type PinRecord = Record<string, unknown>;

function isPinRecord(v: unknown): v is PinRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** How many pins this question allows, 1–10. */
export function pinLimit(q: PinRecord): number {
  const m = q.maxPins;
  return typeof m === 'number' && Number.isFinite(m) && m >= 1
    ? Math.min(PINS_MAX, Math.floor(m))
    : PINS_DEFAULT;
}

/** `[x, y]` for a stored pin, or null for anything the engine couldn't have written. */
export function parsePin(s: unknown): [number, number] | null {
  if (typeof s !== 'string' || s.length > 13) return null;
  const m = PIN_RE.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** A short, stable key of an image source (FNV-1a, 8 hex digits); '' when there is none. */
export function imageKey(src: unknown): string {
  if (typeof src !== 'string' || src.length === 0) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The pins answer to store: well-formed pins only, at most the question's
 * limit, notes trimmed and capped (dropped when the owner turned notes off),
 * and the key of the question's photo. Undefined when no pin is left.
 */
export function pinAnswerCore(
  q: PinRecord,
  v: unknown,
): Record<string, string | string[]> | undefined {
  if (!isPinRecord(v) || !Array.isArray(v.pins)) return undefined;
  const limit = pinLimit(q);
  const rawNotes = q.notes !== false && Array.isArray(v.notes) ? v.notes : [];
  const pins: string[] = [];
  const notes: string[] = [];
  const raw = v.pins.slice(0, PINS_MAX * 4);
  for (let i = 0; i < raw.length && pins.length < limit; i++) {
    const p = raw[i];
    if (typeof p !== 'string' || !parsePin(p)) continue;
    pins.push(p);
    const n = rawNotes[i];
    notes.push(typeof n === 'string' ? n.trim().slice(0, PIN_NOTE_MAX) : '');
  }
  if (pins.length === 0) return undefined;
  const out: Record<string, string | string[]> = { pins };
  if (notes.some((n) => n !== '')) out.notes = notes;
  const key = imageKey(q.image);
  if (key) out.img = key;
  return out;
}
