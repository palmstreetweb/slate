/**
 * Options that share a value tick together, count twice and collide as React
 * keys (CH-05). The studio stops owners saving them (the inspector's Fix,
 * `withUniqueValues` in formChecks.ts), but a form saved or published before
 * that, or a crafted link, can still hold them. Every page that shows a form
 * to a respondent — the public fill, a portable link, the preview and the
 * editor's live preview — shows the first of each value only, which is all a
 * respondent could ever give and what the server keeps (one answer per
 * value). Studio only, so no engine bytes.
 */

import type { Question, Schema } from '@/index.js';

/** The list with each value kept once, the first time it appears. */
export function uniqueByValue<T extends { value: unknown }>(list: ReadonlyArray<T>): T[] {
  const seen = new Set<unknown>();
  return list.filter((o) => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });
}

const LIST_KEYS = ['options', 'rows', 'columns', 'items'] as const;

/** The question with each option, row, column and checklist photo kept once (the same object when nothing repeats). */
export function withoutRepeats<Q extends Question>(q: Q): Q {
  // Something that isn't a question (a crafted link's null) is left as it is (SEC-3).
  if (q === null || typeof q !== 'object') return q;
  let out: Q | null = null;
  for (const key of LIST_KEYS) {
    const list = (q as Record<string, unknown>)[key];
    if (!Array.isArray(list) || !list.every((o) => o !== null && typeof o === 'object')) continue;
    const kept = uniqueByValue(list as Array<{ value: unknown }>);
    if (kept.length < list.length) out = { ...(out ?? q), [key]: kept } as Q;
  }
  return out ?? q;
}

/** Every question, each list kept once per value (the same array when nothing repeats). */
export function withoutRepeatedOptions<Q extends Question>(questions: ReadonlyArray<Q>): Q[] {
  const next = questions.map(withoutRepeats);
  return next.some((q, i) => q !== questions[i]) ? next : (questions as Q[]);
}

/** The schema a respondent is shown (the same object when nothing repeats, or nothing to read). */
export function withoutRepeatedOptionsIn<S extends Schema>(schema: S): S {
  if (!Array.isArray(schema?.questions)) return schema;
  const questions = withoutRepeatedOptions(schema.questions);
  return questions === schema.questions ? schema : { ...schema, questions };
}
