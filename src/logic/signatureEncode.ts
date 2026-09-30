/**
 * Encoding a drawing as a stored signature path (ADR-064). Only the signature
 * pad needs this, so it lives apart from `signature.ts` (which the engine's
 * validator loads for every form) and ships in the pad's on-demand chunk.
 */

import {
  SIG_H,
  SIG_PATH_MAX,
  SIG_POINTS_MAX,
  SIG_STROKES_MAX,
  SIG_W,
  type Point,
} from './signature.js';

/** Perpendicular distance from `p` to the segment a–b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker, iterative (no recursion depth to worry about). */
export function simplifyStroke(points: ReadonlyArray<Point>, epsilon: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = from + 1; k < to; k++) {
      const d = segmentDistance(points[k]!, points[from]!, points[to]!);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at !== -1 && worst > epsilon) {
      keep[at] = 1;
      stack.push([from, at], [at, to]);
    }
  }
  return points.filter((_, k) => keep[k] === 1);
}

function quantize(stroke: ReadonlyArray<Point>): Point[] {
  const out: Point[] = [];
  for (const [x, y] of stroke) {
    const q: Point = [
      Math.round(Math.min(SIG_W, Math.max(0, x))),
      Math.round(Math.min(SIG_H, Math.max(0, y))),
    ];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out;
}

function encodeOnce(strokes: ReadonlyArray<ReadonlyArray<Point>>, epsilon: number): string {
  let path = '';
  let points = 0;
  for (const raw of strokes.slice(0, SIG_STROKES_MAX)) {
    const stroke = quantize(simplifyStroke(quantize(raw), epsilon));
    if (stroke.length === 0) continue;
    if (points + stroke.length > SIG_POINTS_MAX) break;
    points += stroke.length;
    const [x0, y0] = stroke[0]!;
    path += `M${x0} ${y0}`;
    if (stroke.length > 1) {
      const deltas: string[] = [];
      for (let k = 1; k < stroke.length; k++) {
        deltas.push(`${stroke[k]![0] - stroke[k - 1]![0]} ${stroke[k]![1] - stroke[k - 1]![1]}`);
      }
      path += `l${deltas.join(' ')}`;
    }
  }
  return path;
}

/**
 * Encode strokes (points in the 500 × 200 box) as a stored path, simplifying
 * harder until it fits `SIG_PATH_MAX`. Returns '' for no ink.
 */
export function encodeSignature(strokes: ReadonlyArray<ReadonlyArray<Point>>): string {
  let epsilon = 0.7;
  let path = encodeOnce(strokes, epsilon);
  while (path.length > SIG_PATH_MAX && epsilon < 40) {
    epsilon *= 1.6;
    path = encodeOnce(strokes, epsilon);
  }
  // Still too long (an absurd scribble): keep whole strokes that fit.
  while (path.length > SIG_PATH_MAX) {
    path = path.slice(0, path.lastIndexOf('M'));
  }
  return path;
}
