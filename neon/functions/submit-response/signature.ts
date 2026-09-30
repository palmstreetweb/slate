/**
 * Signature paths, server side (ADR-064). A signature answer carries its
 * drawing as a compact SVG path; the submit Function keeps it only when it
 * parses exactly as the engine writes it (whole numbers, M / l commands, the
 * 500 × 200 box, the size and point caps), so a crafted answer can't store
 * arbitrary markup or oversized data.
 *
 * The section below is a byte-for-byte copy of the shared section of
 * src/logic/signature.ts. tests/signature.test.ts fails if the two drift.
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
