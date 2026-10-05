/**
 * Prefill from the page link (ADR-063). Pure, no React.
 *
 * A question opts in with `prefillKey`; `<Form prefill>` passes the link's
 * parameters. Each value is coerced to the question's answer shape and must
 * pass the same validator the field runs, or it is ignored — a bad link never
 * blocks anyone. The respondent still sees every prefilled answer.
 */

import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import { pickLimits, validate, type PickRule } from './validation.js';
import { allowsOther, resolveOtherText } from './other.js';

/** Longest prefilled value, in characters. */
export const PREFILL_VALUE_MAX = 500;

/**
 * Link parameters the fill page reads for itself (source tracking and embed
 * mode). A question can't use one of these as its `prefillKey`.
 */
export const RESERVED_LINK_PARAMS: ReadonlySet<string> = new Set([
  'src',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'embed',
]);

/** Question types that can be prefilled. Consent, files, grids and rankings never are. */
const PREFILLABLE = new Set<Question['type']>([
  'short_text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'date',
  'single_choice',
  'multi_choice',
  'dropdown',
  'picture_choice',
  'yes_no',
  'scale',
  'nps',
]);

export function canPrefill(q: Question): boolean {
  return PREFILLABLE.has(q.type);
}

/** A usable prefill key: 1–40 of `A–Z a–z 0–9 _ -`, not a reserved parameter. */
export function isValidPrefillKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(key) && !RESERVED_LINK_PARAMS.has(key.toLowerCase());
}

function toNumber(text: string): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

function coerce(q: Question, text: string): LooseAnswers[string] {
  switch (q.type) {
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'phone':
    case 'url':
      return text;
    case 'date':
      // As typed into the boxes (GAP-23): "10/20/2026", or "20.10.26" day first; 26 is 2026.
      return text.replace(
        /^(\d\d?)[/.-](\d\d?)[/.-](\d\d|\d{4})$/,
        (_, a: string, b: string, y: string) => {
          const d = q.format === 'DD/MM/YYYY';
          return `${y[2] ? y : '20' + y}-${(d ? b : a).padStart(2, '0')}-${(d ? a : b).padStart(2, '0')}`;
        },
      );
    case 'number':
    case 'scale':
    case 'nps':
      // "1,000" and "$1,500" read as typed into the box (GAP-23).
      return toNumber(text.replace(/^\$|,(?=\d{3}\b)/g, ''));
    case 'yes_no': {
      const t = text.toLowerCase();
      if (YES.has(t) || t === (q.yesLabel ?? '').trim().toLowerCase()) return 'yes';
      if (NO.has(t) || t === (q.noLabel ?? '').trim().toLowerCase()) return 'no';
      return undefined;
    }
    case 'single_choice':
    case 'dropdown':
    case 'picture_choice':
    case 'multi_choice': {
      const many = q.type === 'multi_choice' || (q.type === 'picture_choice' && q.multiple);
      const parts = many ? text.split(',') : [text];
      const picked: string[] = [];
      let other: string | undefined;
      for (const part of parts) {
        if (part.trim() === '') continue;
        const r = resolveOtherText(q.options, part);
        if (r.isOption) {
          if (!picked.includes(r.value)) picked.push(r.value);
        } else if (allowsOther(q) && other === undefined) {
          other = r.value;
        } else if (!many) {
          return undefined;
        }
      }
      if (!many) return picked[0] ?? other;
      // More picks than the question takes: keep the first ones, not none
      // (GAP-23), up to the maximum the question really holds people to (ENG-04).
      const all = (other !== undefined ? [...picked, other] : picked).slice(
        0,
        pickLimits(q as PickRule)[1],
      );
      return all.length ? all : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The answers a link fills in, keyed by question id. Questions without a
 * `prefillKey`, reserved keys, types that can't be prefilled, and values that
 * don't pass the question's validator are all skipped.
 */
export function prefillAnswers(
  questions: ReadonlyArray<Question>,
  params: Readonly<Record<string, string | undefined>> | undefined,
): LooseAnswers {
  const out: LooseAnswers = {};
  if (!params) return out;
  for (const q of questions) {
    if (!canPrefill(q)) continue;
    const key = (q as { prefillKey?: string }).prefillKey?.trim();
    if (!key || !isValidPrefillKey(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    const raw = params[key];
    if (typeof raw !== 'string') continue;
    const text = raw.trim().slice(0, PREFILL_VALUE_MAX);
    if (text === '') continue;
    const value = coerce(q, text);
    if (value === undefined) continue;
    if (validate(q, value) !== null) continue;
    out[q.id] = value;
  }
  return out;
}
