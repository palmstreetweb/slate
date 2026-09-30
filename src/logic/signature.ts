/**
 * Signatures as compact vector strokes (ADR-064) — pure, no React.
 *
 * A drawing is stored inside the answer as an SVG path in a fixed 500 × 200
 * box: each stroke is `M x y` followed by `l dx dy dx dy …` (relative line-to),
 * whole numbers, single spaces. Strokes are simplified (Ramer–Douglas–Peucker)
 * and quantized before encoding (`signatureEncode.ts`, loaded with the pad
 * only), so a typical signature is 1–4 KB, well under the server's
 * per-string limit; a very busy one is simplified harder until it fits
 * `SIG_PATH_MAX`.
 *
 * `parseSignaturePathCore` is mirrored byte for byte in
 * neon/functions/submit-response/signature.ts, which refuses any path the
 * engine couldn't have written (tests/signature.test.ts checks they match).
 */

/* ---------- shared with the server (keep identical) ---------- */

/** The drawing box every stored path lives in. */
export const SIG_W = 500;
export const SIG_H = 200;
/** Longest stored path, in characters. */
export const SIG_PATH_MAX = 8000;
/** Most strokes and points in one signature. */
export const SIG_STROKES_MAX = 80;
export const SIG_POINTS_MAX = 2400;
/** Longest typed name, in characters. */
export const SIG_TYPED_MAX = 100;
/** How far a point may sit outside the box (a stroke that ran off the edge). */
const SIG_SLACK = 4;

function inBox(x: number, y: number): boolean {
  return x >= -SIG_SLACK && x <= SIG_W + SIG_SLACK && y >= -SIG_SLACK && y <= SIG_H + SIG_SLACK;
}

/**
 * Strokes as absolute points, or null for anything the engine couldn't have
 * written: another command, a decimal, a number over four digits, a point
 * outside the box, too many strokes or points, or a path over the limit.
 */
export function parseSignaturePathCore(path: unknown): Array<Array<[number, number]>> | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > SIG_PATH_MAX) return null;
  const n = path.length;
  let i = 0;
  let points = 0;
  const readInt = (): number | null => {
    let neg = false;
    if (path.charCodeAt(i) === 45) {
      neg = true;
      i += 1;
    }
    const start = i;
    while (i < n && i - start < 5) {
      const c = path.charCodeAt(i);
      if (c < 48 || c > 57) break;
      i += 1;
    }
    if (i === start || i - start > 4) return null;
    const v = Number(path.slice(start, i));
    return neg ? -v : v;
  };
  const strokes: Array<Array<[number, number]>> = [];
  while (i < n) {
    if (path.charCodeAt(i) !== 77) return null; // 'M'
    i += 1;
    const x = readInt();
    if (x === null || path.charCodeAt(i) !== 32) return null;
    i += 1;
    const y = readInt();
    if (y === null || !inBox(x, y)) return null;
    let cx = x;
    let cy = y;
    const stroke: Array<[number, number]> = [[cx, cy]];
    points += 1;
    if (path.charCodeAt(i) === 108) {
      // 'l': one or more "dx dy" pairs separated by single spaces
      i += 1;
      for (;;) {
        const dx = readInt();
        if (dx === null || path.charCodeAt(i) !== 32) return null;
        i += 1;
        const dy = readInt();
        if (dy === null) return null;
        cx += dx;
        cy += dy;
        if (!inBox(cx, cy)) return null;
        stroke.push([cx, cy]);
        points += 1;
        if (points > SIG_POINTS_MAX) return null;
        if (path.charCodeAt(i) !== 32) break;
        i += 1;
      }
    }
    strokes.push(stroke);
    if (strokes.length > SIG_STROKES_MAX || points > SIG_POINTS_MAX) return null;
  }
  return strokes;
}

/* ---------- engine-only helpers ---------- */

export type Point = [number, number];

/** Parse a stored path (see the core parser). */
export function parseSignaturePath(path: unknown): Point[][] | null {
  return parseSignaturePathCore(path);
}

/** Total ink length and bounding box of parsed strokes. */
export function inkStats(strokes: ReadonlyArray<ReadonlyArray<Point>>): {
  length: number;
  width: number;
  height: number;
} {
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (let k = 0; k < s.length; k++) {
      const [x, y] = s[k]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (k > 0) length += Math.hypot(x - s[k - 1]![0], y - s[k - 1]![1]);
    }
  }
  if (length === 0 && minX === Infinity) return { length: 0, width: 0, height: 0 };
  return { length, width: maxX - minX, height: maxY - minY };
}

/** Ink this long (box units), spanning at least this far, counts as signing — not a dot or a tap. */
export const SIG_MIN_INK = 40;
export const SIG_MIN_SPAN = 24;

/** A real stroke, not a dot or a stray tap. */
export function isRealSignature(strokes: ReadonlyArray<ReadonlyArray<Point>> | null): boolean {
  if (!strokes || strokes.length === 0) return false;
  const { length, width, height } = inkStats(strokes);
  return length >= SIG_MIN_INK && Math.max(width, height) >= SIG_MIN_SPAN;
}

/** The drawn path of a signature answer, or null. */
export function signaturePathOf(answer: unknown): string | null {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const p = (answer as { path?: unknown }).path;
  return typeof p === 'string' && p ? p : null;
}

/** The typed name of a signature answer, or null. */
export function signatureTypedOf(answer: unknown): string | null {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const t = (answer as { typed?: unknown }).typed;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}
