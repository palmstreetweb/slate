/**
 * Instant estimate (ADR-064) — pure, no React.
 *
 * The estimate is the base price (`schema.estimate.base`) plus every priced
 * answer: each picked choice option with a `price` (a range with `priceMax`),
 * and each number answer times its question's `unitPrice`. It is computed in
 * whole cents so the engine and the server always land on the same number.
 *
 * `computeEstimateCore` is mirrored byte for byte in
 * neon/functions/submit-response/estimate.ts, which recomputes the estimate
 * from the published schema on every submit (the stored number is the
 * server's, never the browser's). tests/estimate.test.ts checks the two
 * agree on fixtures and on random schemas.
 */

import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import type { Estimate, EstimateSettings } from '@/types/Estimate.js';

/* ---------- shared with the server (keep identical) ---------- */

/** Largest price, unit price or base, in currency units. */
export const PRICE_MAX = 10_000_000;
/** Largest quantity a number answer can multiply a unit price by. */
export const QTY_MAX = 100_000;
/** Most breakdown lines kept (every priced answer still counts in the total). */
export const ESTIMATE_LINES_MAX = 40;
/** Longest line label, in characters. */
export const ESTIMATE_LABEL_MAX = 120;
/** Largest total, in currency units. */
const TOTAL_MAX = 1_000_000_000;

type Obj = Record<string, unknown>;
type CoreLine = { id: string; label: string; qty?: number; low: number; high: number };
type CoreEstimate = { low: number; high: number; currency: string; lines: CoreLine[] };

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A price in whole cents, or null when it isn't a finite number. */
function toCents(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const clamped = Math.min(PRICE_MAX, Math.max(-PRICE_MAX, v));
  return Math.round(clamped * 100);
}

/** [low, high] in cents from a price and an optional high end; null when unpriced. */
function rangeOf(price: unknown, priceMax: unknown): [number, number] | null {
  const low = toCents(price);
  if (low === null) return null;
  const high = toCents(priceMax);
  return [low, high === null || high < low ? low : high];
}

function clip(text: string): string {
  const t = text.trim();
  return t.length > ESTIMATE_LABEL_MAX ? t.slice(0, ESTIMATE_LABEL_MAX) : t;
}

/** 'USD' unless the setting is a three-letter code. */
export function estimateCurrency(settings: unknown): string {
  const c = isObj(settings) ? settings.currency : undefined;
  return typeof c === 'string' && /^[A-Z]{3}$/.test(c) ? c : 'USD';
}

const CHOICE_TYPES = ['single_choice', 'multi_choice', 'dropdown', 'picture_choice'];

/** True when the schema prices anything: a base, an option, or a unit. */
export function hasPricingCore(schema: unknown): boolean {
  if (!isObj(schema)) return false;
  if (isObj(schema.estimate) && toCents(schema.estimate.base) !== null) return true;
  const questions = Array.isArray(schema.questions) ? schema.questions : [];
  for (const q of questions) {
    if (!isObj(q)) continue;
    if (q.type === 'number' && toCents(q.unitPrice) !== null) return true;
    if (CHOICE_TYPES.includes(String(q.type)) && Array.isArray(q.options)) {
      for (const o of q.options) if (isObj(o) && toCents(o.price) !== null) return true;
    }
  }
  return false;
}

/**
 * The estimate for `answers` (keyed by question id), or null when the schema
 * prices nothing. Works on plain JSON, so the server can run it on the
 * published schema as stored.
 */
export function computeEstimateCore(schema: unknown, answers: unknown): CoreEstimate | null {
  if (!hasPricingCore(schema) || !isObj(schema)) return null;
  const given = isObj(answers) ? answers : {};
  const settings = isObj(schema.estimate) ? schema.estimate : {};
  const lines: CoreLine[] = [];
  let low = 0;
  let high = 0;
  const add = (line: CoreLine) => {
    low += line.low;
    high += line.high;
    if (lines.length < ESTIMATE_LINES_MAX) lines.push(line);
  };

  const base = rangeOf(settings.base, settings.baseMax);
  if (base) {
    const label = typeof settings.baseLabel === 'string' ? clip(settings.baseLabel) : '';
    add({ id: '_base', label: label || 'Base price', low: base[0], high: base[1] });
  }

  const questions = Array.isArray(schema.questions) ? schema.questions : [];
  const seen = new Set<string>();
  for (const q of questions) {
    if (!isObj(q) || typeof q.id !== 'string' || seen.has(q.id)) continue;
    seen.add(q.id);
    const value = Object.prototype.hasOwnProperty.call(given, q.id) ? given[q.id] : undefined;
    if (value === undefined || value === null) continue;

    if (q.type === 'number') {
      const unit = rangeOf(q.unitPrice, q.unitPriceMax);
      if (!unit || typeof value !== 'number' || !Number.isFinite(value)) continue;
      // None of them (0) adds no line; negatives and absurd counts are refused.
      if (value <= 0 || value > QTY_MAX) continue;
      if (typeof q.min === 'number' && value < q.min) continue;
      if (typeof q.max === 'number' && value > q.max) continue;
      const unitName = typeof q.unit === 'string' ? clip(q.unit) : '';
      const title = typeof q.title === 'string' ? clip(q.title) : '';
      const label = unitName
        ? unitName.charAt(0).toUpperCase() + unitName.slice(1)
        : title || 'Quantity';
      add({
        id: q.id,
        label,
        qty: value,
        low: Math.round(unit[0] * value),
        high: Math.round(unit[1] * value),
      });
      continue;
    }

    if (!CHOICE_TYPES.includes(String(q.type)) || !Array.isArray(q.options)) continue;
    const picked = Array.isArray(value) ? value : [value];
    const done = new Set<string>();
    for (const v of picked) {
      if (typeof v !== 'string' || done.has(v)) continue;
      done.add(v);
      const option = q.options.find((o: unknown) => isObj(o) && o.value === v) as Obj | undefined;
      if (!option) continue;
      const range = rangeOf(option.price, option.priceMax);
      if (!range) continue;
      const label = typeof option.label === 'string' ? clip(option.label) : '';
      add({
        id: q.id,
        label: label || v.slice(0, ESTIMATE_LABEL_MAX),
        low: range[0],
        high: range[1],
      });
    }
  }

  const cap = TOTAL_MAX * 100;
  const lo = Math.min(cap, Math.max(0, low));
  const hi = Math.min(cap, Math.max(lo, high));
  return {
    low: lo / 100,
    high: hi / 100,
    currency: estimateCurrency(settings),
    lines: lines.map((l) => ({ ...l, low: l.low / 100, high: l.high / 100 })),
  };
}

/* ---------- engine-only helpers ---------- */

type EstimateSchema = { questions: ReadonlyArray<Question>; estimate?: EstimateSettings };

/** True when the schema prices anything (an estimate can be shown). */
export function hasPricing(schema: EstimateSchema): boolean {
  return hasPricingCore(schema);
}

/** The estimate for these answers, or null when nothing on the form has a price. */
export function computeEstimate(schema: EstimateSchema, answers: LooseAnswers): Estimate | null {
  return computeEstimateCore(schema, answers);
}

/** 0 when every amount is a whole number of currency units, else 2. */
export function estimateFraction(e: Pick<Estimate, 'low' | 'high' | 'lines'>): 0 | 2 {
  const amounts = [e.low, e.high, ...e.lines.flatMap((l) => [l.low, l.high])];
  return amounts.every((n) => Number.isInteger(n)) ? 0 : 2;
}

/** "$2,400" in the respondent's locale; falls back to "USD 2400" without Intl support for the code. */
export function formatMoney(amount: number, currency: string, fraction: 0 | 2 = 0): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(fraction)}`;
  }
}

/** "$2,400 – $3,100", or "$2,400" for an exact price. */
export function formatMoneyRange(
  low: number,
  high: number,
  currency: string,
  fraction: 0 | 2 = 0,
): string {
  const a = formatMoney(low, currency, fraction);
  return high > low ? `${a} – ${formatMoney(high, currency, fraction)}` : a;
}

/** The estimate's total as text: "$2,400 – $3,100". */
export function formatEstimate(e: Estimate): string {
  return formatMoneyRange(e.low, e.high, e.currency, estimateFraction(e));
}

/** An option's or unit's price as text ("$450", "$8,000 – $12,000"), or null when unpriced. */
export function formatPrice(
  price: number | undefined,
  priceMax: number | undefined,
  currency: string,
): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  const high = typeof priceMax === 'number' && priceMax > price ? priceMax : price;
  const fraction = Number.isInteger(price) && Number.isInteger(high) ? 0 : 2;
  return formatMoneyRange(price, high, currency, fraction);
}
