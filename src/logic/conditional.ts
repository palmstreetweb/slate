/**
 * Pure evaluator for `Condition`s. See BUILD_BRIEF.md §7.
 *
 * Semantics:
 *   - Unknown fields are treated as empty.
 *   - For multi_choice answers (arrays):
 *       `equals` / `not_equals` → membership in the array
 *       `in` / `not_in`         → any selected matches any value in the list
 *   - `is_empty` / `is_not_empty` treat undefined, null, '', [] as empty.
 *   - Composite conditions (`{ all: [...] }`, `{ any: [...] }`) are recursive.
 *   - `OTHER_VALUE` as a target means "picked Other" (ADR-063). It needs the
 *     question's option values, passed as `others` (see `otherIndex`);
 *     without them it matches nothing.
 *   - `IN_AREA_VALUE` / `OUT_OF_AREA_VALUE` on an address question compare its
 *     ZIP with the question's service area (ADR-064); on a location question,
 *     its position with the radius (ADR-065). Passed as `areas` (see
 *     `areaIndex`). No area, or no answer to check yet, matches neither.
 *   - Sign-up slots (ADR-066): a slot's value means "took that slot";
 *     `WAITLIST_VALUE` means "joined a waitlist".
 */

import type { Condition } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { OTHER_VALUE, hasOtherAnswer, type OtherIndex } from './other.js';
import { IN_AREA_VALUE, OUT_OF_AREA_VALUE, type AreaIndex } from './address.js';
import { WAITLIST_VALUE } from './signupAnswer.js';

type AreaCheck = (answer: unknown) => 'in' | 'out' | null;

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  // Contact, address and signature answers (ADR-064): empty when nothing is filled.
  if (typeof v === 'object' && !(typeof File !== 'undefined' && v instanceof File)) {
    return Object.values(v as Record<string, unknown>).every((x) => isEmpty(x));
  }
  return false;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function eqLeaf(
  answer: unknown,
  target: string | number,
  optionValues: ReadonlySet<string> | undefined,
  area: AreaCheck | undefined,
): boolean {
  if (target === OTHER_VALUE) return optionValues ? hasOtherAnswer(answer, optionValues) : false;
  if (target === IN_AREA_VALUE) return area ? area(answer) === 'in' : false;
  if (target === OUT_OF_AREA_VALUE) return area ? area(answer) === 'out' : false;
  // A sign-up answer (ADR-066) is tested by its taken slots, or its waitlists.
  const s = answer as { slots?: unknown; wait?: unknown } | null;
  if (s && typeof s === 'object' && Array.isArray(s.slots)) {
    return target === WAITLIST_VALUE
      ? Array.isArray(s.wait) && s.wait.length > 0
      : s.slots.includes(target);
  }
  const arr = asArray(answer);
  if (arr) return arr.some((x) => x === target);
  return answer === target;
}

function inLeaf(
  answer: unknown,
  targets: ReadonlyArray<string | number>,
  optionValues: ReadonlySet<string> | undefined,
  area: AreaCheck | undefined,
): boolean {
  return targets.some((t) => eqLeaf(answer, t, optionValues, area));
}

export function evaluate(
  condition: Condition,
  answers: LooseAnswers,
  others?: OtherIndex,
  areas?: AreaIndex,
): boolean {
  // A condition that can't be read (a schema from a link, or a host's typo)
  // never holds: a rule carrying it doesn't fire — and nothing crashes.
  if (!condition || typeof condition !== 'object') return false;
  if ('all' in condition) {
    return (
      Array.isArray(condition.all) &&
      condition.all.every((c) => evaluate(c, answers, others, areas))
    );
  }
  if ('any' in condition) {
    return (
      Array.isArray(condition.any) && condition.any.some((c) => evaluate(c, answers, others, areas))
    );
  }

  const value = answers[condition.field];
  const optionValues = others?.get(condition.field);
  const area = areas?.get(condition.field);

  switch (condition.op) {
    case 'equals':
      return eqLeaf(value, condition.value, optionValues, area);
    case 'not_equals':
      return !eqLeaf(value, condition.value, optionValues, area);
    case 'in':
      return inLeaf(value, condition.value, optionValues, area);
    case 'not_in':
      return !inLeaf(value, condition.value, optionValues, area);
    case 'gt':
      return typeof value === 'number' && value > condition.value;
    case 'lt':
      return typeof value === 'number' && value < condition.value;
    case 'gte':
      return typeof value === 'number' && value >= condition.value;
    case 'lte':
      return typeof value === 'number' && value <= condition.value;
    case 'is_empty':
      return isEmpty(value);
    case 'is_not_empty':
      return !isEmpty(value);
  }
}
