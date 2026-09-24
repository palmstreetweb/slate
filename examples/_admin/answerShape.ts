/**
 * Untrusted answers → the shapes the studio renders (audit H1).
 *
 * Submissions are written by anonymous respondents, so a stored answer can be
 * anything JSON allows. One object like `{"toString": 1}` used to reach
 * `String()` during render and unmount the whole studio. Everything loaded
 * from the database passes through here once, in `rowToSubmission`, so the
 * rest of the studio only ever sees what `LooseAnswers` promises:
 *
 *   string · number · string[] · Record<string, string | string[]>  (booleans → 'true' / 'false')
 *
 * Anything else is dropped. Never throws.
 */

import type { Answers } from '@/index.js';
import type { StoredSubmission } from './_submissionStore.js';

const MAX_KEYS = 200;
const MAX_ITEMS = 200;
const MAX_ROW_KEYS = 100;

/** Keys that shadow Object.prototype (`toString`, `__proto__`, …) are never kept. */
function isSafeKey(key: string): boolean {
  return key.length > 0 && key.length <= 128 && !(key in Object.prototype);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A scalar as text, or null when it isn't one. */
function scalarText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return null;
}

function stringList(v: unknown[]): string[] {
  const out: string[] = [];
  for (const item of v.slice(0, MAX_ITEMS)) {
    const text = scalarText(item);
    if (text !== null) out.push(text);
  }
  return out;
}

/** One answer value, or undefined to drop it. */
export function normalizeAnswerValue(v: unknown): Answers[string] {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof File !== 'undefined' && v instanceof File) return v;
  if (Array.isArray(v)) return stringList(v);
  if (isPlainObject(v)) {
    // matrix: row → column value(s)
    const row: Record<string, string | string[]> = {};
    for (const [k, cell] of Object.entries(v).slice(0, MAX_ROW_KEYS)) {
      if (!isSafeKey(k)) continue;
      if (Array.isArray(cell)) row[k] = stringList(cell);
      else {
        const text = scalarText(cell);
        if (text !== null) row[k] = text;
      }
    }
    return row;
  }
  return undefined;
}

export function normalizeAnswers(raw: unknown): Answers {
  const out: Answers = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_KEYS)) {
    if (!isSafeKey(k)) continue;
    const value = normalizeAnswerValue(v);
    if (value !== undefined) (out as Record<string, unknown>)[k] = value;
  }
  return out;
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function normalizeMeta(raw: unknown): StoredSubmission['meta'] {
  const m = isPlainObject(raw) ? raw : {};
  const hidden: Record<string, unknown> = {};
  if (isPlainObject(m.hiddenFields)) {
    for (const [k, v] of Object.entries(m.hiddenFields).slice(0, 50)) {
      const text = scalarText(v);
      if (isSafeKey(k) && text !== null) hidden[k] = text;
    }
  }
  return {
    startedAt: typeof m.startedAt === 'string' ? m.startedAt : '',
    completedAt: typeof m.completedAt === 'string' ? m.completedAt : '',
    durationMs: Math.max(0, finiteNumber(m.durationMs) ?? 0),
    questionsVisited: Array.isArray(m.questionsVisited)
      ? m.questionsVisited.filter((x): x is string => typeof x === 'string').slice(0, MAX_ITEMS)
      : [],
    hiddenFields: hidden,
    score: finiteNumber(m.score) ?? 0,
  };
}

/**
 * Last-resort text for any value. Used by formatters for anything that isn't
 * already a string, so a hostile value can never throw during render.
 */
export function safeText(v: unknown, depth = 0): string {
  if (v === undefined || v === null) return '';
  const text = scalarText(v);
  if (text !== null) return text;
  if (typeof File !== 'undefined' && v instanceof File) return v.name;
  if (depth > 3) return '';
  if (Array.isArray(v)) return v.map((item) => safeText(item, depth + 1)).join(', ');
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}
