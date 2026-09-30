/**
 * Instant estimate (ADR-064). Owners put prices on choice options and a price
 * per unit on number answers; the estimate is the base plus every priced
 * answer, as a low–high range. It sits beside scoring (ADR-016), not inside
 * it: a score is one client-side number, an estimate is money — a range, a
 * currency, a breakdown — and the server recomputes it from the published
 * schema so the number an owner reads can't be forged.
 */

/** Form-level estimate settings: `schema.estimate`. */
export type EstimateSettings = {
  /** ISO 4217 code, e.g. 'USD' (default), 'CAD', 'EUR'. */
  currency?: string;
  /** Added to every estimate, e.g. a service call or a minimum. */
  base?: number;
  /** High end of the base, for a base range. */
  baseMax?: number;
  /** The base's line in the breakdown; default 'Base price'. */
  baseLabel?: string;
  /** Heading on the Thank You screen; default 'Your estimate'. */
  label?: string;
  /** Small print under the number, e.g. 'Final price after inspection'. */
  disclaimer?: string;
  /** Show one line per priced answer under the total. */
  breakdown?: boolean;
};

/** One priced answer (or the base) in an estimate. */
export type EstimateLine = {
  /** The question id, or `_base` for the base price. */
  id: string;
  /** The option's label, the unit (numbers), or the base label. */
  label: string;
  /** Number answers: the quantity the unit price was multiplied by. */
  qty?: number;
  low: number;
  high: number;
};

/** A computed estimate, in currency units (not cents). `low === high` for an exact price. */
export type Estimate = {
  low: number;
  high: number;
  currency: string;
  lines: EstimateLine[];
};
