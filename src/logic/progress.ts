/**
 * Pure helpers around the visible-questions list and progress reporting.
 *
 * `welcome`, `statement`, and `thanks` are *chrome screens* — they're shown
 * but they don't count toward the progress bar (which represents the
 * fraction of *answer-bearing* questions completed).
 */

import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { evaluate } from './conditional.js';

/** Question types that are not answer-bearing. */
const CHROME_TYPES = new Set(['welcome', 'statement', 'thanks']);

function isChrome(q: Question): boolean {
  return CHROME_TYPES.has(q.type);
}

/**
 * Filter the schema's questions down to the ones currently visible based on
 * the answer state. `visibleIf` is the only filter; chrome questions don't
 * carry one and pass through.
 */
export function visibleQuestions(
  all: ReadonlyArray<Question>,
  answers: LooseAnswers,
): Question[] {
  return all.filter((q) => {
    if ('visibleIf' in q && q.visibleIf) {
      return evaluate(q.visibleIf, answers);
    }
    return true;
  });
}

/**
 * Progress percentage 0–100. Counts only answer-bearing questions in the
 * visible list. `currentStep` is the index in `visible` of the question
 * currently being shown.
 */
export function progress(visible: ReadonlyArray<Question>, currentStep: number): number {
  const totalCounted = visible.filter((q) => !isChrome(q)).length;
  if (totalCounted === 0) return 0;
  const passed = visible.slice(0, currentStep).filter((q) => !isChrome(q)).length;
  return clamp((passed / totalCounted) * 100, 0, 100);
}

/**
 * The "answers payload" that gets passed to `onSubmit` — strictly the answers
 * to currently-visible answer-bearing questions. Hidden answers are retained
 * in the engine's internal state but excluded here per ADR-005.
 */
export function visibleAnswersForSubmit(
  visible: ReadonlyArray<Question>,
  allAnswers: LooseAnswers,
): LooseAnswers {
  const out: LooseAnswers = {};
  for (const q of visible) {
    if (isChrome(q)) continue;
    if (q.id in allAnswers && allAnswers[q.id] !== undefined) {
      out[q.id] = allAnswers[q.id];
    }
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
