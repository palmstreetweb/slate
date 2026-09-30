/**
 * Pin the spot (ADR-065) — pure, no React.
 *
 * A pin is stored as `'x,y'`: fractions of the photo's width and height from
 * its top left, 0 to 1, at most 4 decimals (a tenth of a pixel on a 1,000 px
 * photo). Notes sit in a parallel list. `img` is a short key of the photo the
 * pins were placed on, so Responses can say when the owner has since swapped
 * the photo; the server sets it from the published form.
 *
 * The shared section is copied byte for byte into
 * neon/functions/submit-response/pins.ts (tests/pins.test.ts compares them).
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

/* ---------- engine-only helpers ---------- */

/** One pin as stored: each coordinate clamped to 0–1 and rounded to 4 decimals. */
export function pinText(x: number, y: number): string {
  const r = (n: number) => String(Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000);
  return `${r(x)},${r(y)}`;
}

/** Pins and notes from a stored answer (malformed pins skipped). */
export function pinsOf(answer: unknown): Array<{ x: number; y: number; note: string }> {
  if (!isPinRecord(answer) || !Array.isArray(answer.pins)) return [];
  const notes = Array.isArray(answer.notes) ? answer.notes : [];
  const out: Array<{ x: number; y: number; note: string }> = [];
  answer.pins.slice(0, PINS_MAX).forEach((p, i) => {
    const xy = parsePin(p);
    if (!xy) return;
    const n = notes[i];
    out.push({ x: xy[0], y: xy[1], note: typeof n === 'string' ? n : '' });
  });
  return out;
}

/** "2 spots: leak here; missing shingles" — for piping and Responses. */
export function formatPins(answer: unknown): string {
  const pins = pinsOf(answer);
  if (pins.length === 0) return '';
  const head = `${pins.length} ${pins.length === 1 ? 'spot' : 'spots'}`;
  const notes = pins.map((p) => p.note.trim()).filter(Boolean);
  return notes.length ? `${head}: ${notes.join('; ')}` : head;
}
