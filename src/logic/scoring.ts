/**
 * Scoring — pure accumulator over option-level `score` values (ADR-016).
 *
 * Every option-bearing question type (single_choice, multi_choice, dropdown,
 * picture_choice) contributes the `score` of each selected option. Questions
 * without scored options contribute 0. The total is exposed in `SubmitMeta`
 * and in piping as `{{score}}`.
 */

import type { Option, Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

function optionScore(options: ReadonlyArray<Option>, value: unknown): number {
  if (typeof value === 'string') {
    return options.find((o) => o.value === value)?.score ?? 0;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (sum, v) => sum + (options.find((o) => o.value === v)?.score ?? 0),
      0,
    );
  }
  return 0;
}

/** Total score for the current answer state. */
export function computeScore(
  questions: ReadonlyArray<Question>,
  answers: LooseAnswers,
): number {
  let total = 0;
  for (const q of questions) {
    switch (q.type) {
      case 'single_choice':
      case 'multi_choice':
      case 'dropdown':
      case 'picture_choice':
        total += optionScore(q.options, answers[q.id]);
        break;
      default:
        break;
    }
  }
  return total;
}
