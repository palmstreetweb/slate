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
 */

import type { Condition } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function eqLeaf(answer: unknown, target: string | number): boolean {
  const arr = asArray(answer);
  if (arr) return arr.some((x) => x === target);
  return answer === target;
}

function inLeaf(answer: unknown, targets: ReadonlyArray<string | number>): boolean {
  const arr = asArray(answer);
  if (arr) return arr.some((x) => targets.some((t) => t === x));
  return targets.some((t) => t === answer);
}

export function evaluate(condition: Condition, answers: LooseAnswers): boolean {
  if ('all' in condition) {
    return condition.all.every((c) => evaluate(c, answers));
  }
  if ('any' in condition) {
    return condition.any.some((c) => evaluate(c, answers));
  }

  const value = answers[condition.field];

  switch (condition.op) {
    case 'equals':
      return eqLeaf(value, condition.value);
    case 'not_equals':
      return !eqLeaf(value, condition.value);
    case 'in':
      return inLeaf(value, condition.value);
    case 'not_in':
      return !inLeaf(value, condition.value);
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
