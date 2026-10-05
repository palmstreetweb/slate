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
import { otherIndex, type OtherIndex } from './other.js';
import { areaIndex, type AreaIndex } from './address.js';

/** Question types that are not answer-bearing. */
const CHROME_TYPES = new Set(['welcome', 'statement', 'review', 'thanks']);

export function isChrome(q: Question): boolean {
  return CHROME_TYPES.has(q.type);
}

/**
 * Filter the schema's questions down to the ones currently visible based on
 * the answer state. `visibleIf` is the only filter; chrome questions don't
 * carry one and pass through.
 */
export function visibleQuestions(all: ReadonlyArray<Question>, answers: LooseAnswers): Question[] {
  const others = otherIndex(all);
  const areas = areaIndex(all);
  return all.filter((q) => {
    if ('visibleIf' in q && q.visibleIf) {
      return evaluate(q.visibleIf, answers, others, areas);
    }
    return true;
  });
}

/**
 * Logic jumps (ADR-015). Evaluate the current question's `logic` rules
 * against the answer state; the first matching rule wins. Returns the index
 * of the jump target in the `visible` list, or null when no rule matches,
 * the question carries no rules, or the target isn't currently visible
 * (dangling/hidden targets fall back to normal flow rather than erroring).
 */
export function resolveJumpTarget(
  current: Question,
  visible: ReadonlyArray<Question>,
  answers: LooseAnswers,
  others: OtherIndex = otherIndex(visible),
  areas: AreaIndex = areaIndex(visible),
): number | null {
  if (!('logic' in current) || !current.logic || current.logic.length === 0) return null;
  for (const rule of current.logic) {
    if (evaluate(rule.if, answers, others, areas)) {
      const idx = visible.findIndex((q) => q.id === rule.goTo);
      return idx >= 0 ? idx : null;
    }
  }
  return null;
}

/**
 * The respondent's path through `visible` with these answers (ADR-069): the
 * steps from the first one, each advance taken the way the form takes it (a
 * matching logic jump, else the next step), up to the first ending or a step
 * already on it. Questions a jump passes over are not on the path. It is a
 * pure function of the answers, so going Back and changing an answer
 * changes the path the same way it changes where the form goes.
 */
export function pathOf(
  visible: ReadonlyArray<Question>,
  answers: LooseAnswers,
  others?: OtherIndex,
  areas?: AreaIndex,
): number[] {
  const path: number[] = [];
  for (let i = 0; i < visible.length && !path.includes(i); ) {
    path.push(i);
    if (visible[i]!.type === 'thanks') break;
    const jump = resolveJumpTarget(visible[i]!, visible, answers, others, areas);
    i = jump !== null && jump !== i ? jump : i + 1;
  }
  return path;
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
 * to currently-visible answer-bearing questions on the respondent's path.
 * Hidden answers are retained in the engine's internal state but excluded
 * here per ADR-005, and so are answers a logic jump now passes over (ADR-069:
 * the respondent went Back and took the other branch).
 */
export function visibleAnswersForSubmit(
  visible: ReadonlyArray<Question>,
  allAnswers: LooseAnswers,
  others?: OtherIndex,
  areas?: AreaIndex,
): LooseAnswers {
  const out: LooseAnswers = {};
  for (const i of pathOf(visible, allAnswers, others, areas)) {
    const q = visible[i]!;
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
