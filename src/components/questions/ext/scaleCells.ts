/**
 * The values a rating offers, shared by the numbers scale, NPS and the styled
 * scales. On-demand only: nothing the engine's core imports may import this
 * (a core module's exports all ship up front, AGENTS.md).
 */

/** More cells than this and a scale is clearly misconfigured; draw the first ones only. */
export const MAX_CELLS = 21;

type Range = { min: number; max: number; step?: number };

/** min and max in order, with a usable step: a schema can arrive the wrong way round. */
export function scaleRange(q: Range): { lo: number; hi: number; step: number } {
  const a = Number.isFinite(q.min) ? q.min : 0;
  const b = Number.isFinite(q.max) ? q.max : 10;
  const step = typeof q.step === 'number' && q.step > 0 ? q.step : 1;
  return { lo: Math.min(a, b), hi: Math.max(a, b), step };
}

/** Rounded so a 0.1 step reads 0.3, not 0.30000000000000004. */
const tidy = (v: number) => Number(v.toFixed(6));

/** min to max by step, at most MAX_CELLS of them; never empty. */
export function scaleValues(q: Range): number[] {
  const { lo, hi, step } = scaleRange(q);
  const out: number[] = [];
  for (let i = 0; out.length < MAX_CELLS; i++) {
    const v = tidy(lo + i * step);
    if (v > hi + 1e-9) break;
    out.push(v);
  }
  return out.length ? out : [lo];
}

/** The step value nearest `n`, inside the range. */
export function nearestStep(q: Range, n: number): number {
  const { lo, hi, step } = scaleRange(q);
  const steps = Math.floor((hi - lo) / step + 1e-9);
  return tidy(lo + Math.min(steps, Math.max(0, Math.round((n - lo) / step))) * step);
}
