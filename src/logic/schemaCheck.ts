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

export type SchemaIssue = {
  /** The question carrying the problem. */
  questionId: string;
  kind: 'duplicate_id' | 'dangling_condition' | 'dangling_jump' | 'self_jump';
  message: string;
};

function conditionFields(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(conditionFields);
  if ('any' in c) return c.any.flatMap(conditionFields);
  return [c.field];
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

  for (const q of questions) {
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
