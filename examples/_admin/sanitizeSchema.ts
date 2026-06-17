/**
 * Strip skip rules that were saved before a destination was chosen (`goTo: ""`).
 * Incomplete rules stay editable in the Inspector as drafts; they must not
 * persist in the schema or trip `checkSchema`.
 */

import type { Question, Schema } from '@/index.js';

function isCompleteJumpRule(rule: { goTo: string }): boolean {
  return rule.goTo.trim().length > 0;
}

export function stripIncompleteJumpRules(
  questions: ReadonlyArray<Question>,
): Question[] {
  let changed = false;
  const next = questions.map((q) => {
    if (!('logic' in q) || !q.logic?.length) return q;
    const logic = q.logic.filter(isCompleteJumpRule);
    if (logic.length === q.logic.length) return q;
    changed = true;
    if (logic.length === 0) {
      const { logic: _removed, ...rest } = q;
      return rest as Question;
    }
    return { ...q, logic };
  });
  return changed ? next : (questions as Question[]);
}

export function sanitizeSchemaLogic(schema: Schema): Schema {
  const questions = stripIncompleteJumpRules(schema.questions);
  return questions === schema.questions ? schema : { ...schema, questions };
}
