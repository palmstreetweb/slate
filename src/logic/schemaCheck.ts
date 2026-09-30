/**
 * Schema sanity checker (roadmap Phase 6) — pure, no React. Catches authoring
 * mistakes that the type system can't: duplicate ids, `visibleIf` conditions
 * referencing unknown questions, and logic jumps targeting unknown ids or
 * the carrying question itself.
 *
 * The engine stays forgiving at runtime (dangling refs fall through to
 * normal flow); this is for builders/CI to surface problems early.
 */

import type { Condition, Question } from '@/types/Question.js';
import { OTHER_VALUE, allowsOther } from './other.js';
import { canPrefill, isValidPrefillKey } from './prefill.js';

export type SchemaIssue = {
  /** The question carrying the problem. */
  questionId: string;
  kind:
    | 'duplicate_id'
    | 'dangling_condition'
    | 'dangling_jump'
    | 'self_jump'
    /** A condition asks for "Other" on a question that doesn't offer it (ADR-063). */
    | 'other_off'
    /** A prefill key is malformed, reserved, or used twice (ADR-063). */
    | 'bad_prefill_key'
    /** `min` is above `max` (number, scale, date). */
    | 'bad_bounds';
  message: string;
};

function conditionFields(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(conditionFields);
  if ('any' in c) return c.any.flatMap(conditionFields);
  return [c.field];
}

/** Fields whose leaf condition targets OTHER_VALUE. */
function otherFields(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(otherFields);
  if ('any' in c) return c.any.flatMap(otherFields);
  if (!('value' in c)) return [];
  const values = Array.isArray(c.value) ? c.value : [c.value];
  return values.includes(OTHER_VALUE) ? [c.field] : [];
}

/** Validate a questions list. Returns an empty array when the schema is clean. */
export function checkSchema(questions: ReadonlyArray<Question>): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const ids = new Set<string>();
  const seenDuplicates = new Set<string>();

  for (const q of questions) {
    if (ids.has(q.id) && !seenDuplicates.has(q.id)) {
      seenDuplicates.add(q.id);
      issues.push({
        questionId: q.id,
        kind: 'duplicate_id',
        message: `Duplicate question id "${q.id}"`,
      });
    }
    ids.add(q.id);
  }

  const byId = new Map(questions.map((q) => [q.id, q] as const));
  const checkOther = (q: Question, c: Condition) => {
    for (const field of otherFields(c)) {
      const target = byId.get(field);
      if (target && !allowsOther(target)) {
        issues.push({
          questionId: q.id,
          kind: 'other_off',
          message: `"${q.id}" checks for Other on "${field}", which has no Other choice`,
        });
      }
    }
  };

  const prefillKeys = new Map<string, string>();
  for (const q of questions) {
    const key = (q as { prefillKey?: string }).prefillKey?.trim();
    if (key && canPrefill(q)) {
      const lower = key.toLowerCase();
      if (!isValidPrefillKey(key)) {
        issues.push({
          questionId: q.id,
          kind: 'bad_prefill_key',
          message: `"${q.id}" has a link name "${key}" that can't be used (letters, numbers, - and _; not src, embed or utm_…)`,
        });
      } else if (prefillKeys.has(lower)) {
        issues.push({
          questionId: q.id,
          kind: 'bad_prefill_key',
          message: `"${q.id}" and "${prefillKeys.get(lower)}" share the link name "${key}"`,
        });
      } else {
        prefillKeys.set(lower, q.id);
      }
    }
    if (q.type === 'number' || q.type === 'scale' || q.type === 'date') {
      const { min, max } = q as { min?: number | string; max?: number | string };
      if (min !== undefined && max !== undefined && min > max) {
        issues.push({
          questionId: q.id,
          kind: 'bad_bounds',
          message: `"${q.id}" has a minimum above its maximum`,
        });
      }
    }
  }

  for (const q of questions) {
    if ('visibleIf' in q && q.visibleIf) checkOther(q, q.visibleIf);
    if ('logic' in q && q.logic) for (const rule of q.logic) checkOther(q, rule.if);
    if ('visibleIf' in q && q.visibleIf) {
      for (const field of conditionFields(q.visibleIf)) {
        if (!ids.has(field)) {
          issues.push({
            questionId: q.id,
            kind: 'dangling_condition',
            message: `"${q.id}" has a visibleIf referencing unknown question "${field}"`,
          });
        }
      }
    }

    if ('logic' in q && q.logic) {
      for (const rule of q.logic) {
        for (const field of conditionFields(rule.if)) {
          if (!ids.has(field)) {
            issues.push({
              questionId: q.id,
              kind: 'dangling_condition',
              message: `"${q.id}" has a jump condition referencing unknown question "${field}"`,
            });
          }
        }
        if (!ids.has(rule.goTo)) {
          issues.push({
            questionId: q.id,
            kind: 'dangling_jump',
            message: `"${q.id}" jumps to unknown question "${rule.goTo}"`,
          });
        } else if (rule.goTo === q.id) {
          issues.push({
            questionId: q.id,
            kind: 'self_jump',
            message: `"${q.id}" jumps to itself`,
          });
        }
      }
    }
  }

  return issues;
}
