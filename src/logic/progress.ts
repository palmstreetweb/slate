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

/** `visibleIf` is the only filter; chrome questions don't carry one and pass through. */
function shows(q: Question, answers: LooseAnswers, others?: OtherIndex, areas?: AreaIndex) {
  return !('visibleIf' in q && q.visibleIf) || evaluate(q.visibleIf, answers, others, areas);
}

/**
 * Filter the schema's questions down to the ones currently visible based on
 * the answer state.
 */
export function visibleQuestions(all: ReadonlyArray<Question>, answers: LooseAnswers): Question[] {
  const others = otherIndex(all);
  const areas = areaIndex(all);
  return all.filter((q) => shows(q, answers, others, areas));
}

/**
 * Logic jumps (ADR-015). Evaluate the current question's `logic` rules
 * against the answer state; the first matching rule wins. Returns the index
 * of the jump target in the `visible` list, or null when no rule matches,
 * the question carries no rules, or the target isn't shown with these
 * answers (dangling/hidden targets fall back to normal flow rather than
 * erroring).
 */
export function resolveJumpTarget(
  current: Question,
  visible: ReadonlyArray<Question>,
  answers: LooseAnswers,
  others: OtherIndex = otherIndex(visible),
  areas: AreaIndex = areaIndex(visible),
): number | null {
  for (const rule of ('logic' in current && current.logic) || []) {
    if (evaluate(rule.if, answers, others, areas)) {
      const idx = visible.findIndex((q) => q.id === rule.goTo);
      return idx >= 0 && shows(visible[idx]!, answers, others, areas) ? idx : null;
    }
  }
  return null;
}

/** The steps of a path, and where its last step goes on to (a loop back, or past the end). */
export type Path = number[] & { next: number };

/**
 * The respondent's path through `visible` with these answers (ADR-069), in
 * the order they meet it: from the first step, each advance the way the form
 * takes it, up to the first ending or a step already on it. Navigation, the
 * Review step and the submit all read it.
 *
 * - A step reads only what had been given by the time it is reached: the
 *   answers to the steps on the path so far and to the questions before it,
 *   plus what the link filled in (`keep`). A rule reading a later answer, or
 *   jumping to a question a later answer shows, never fires on answers given
 *   after it, so those answers stay on the path (CON-01), and Back and on
 *   again goes where the form went the first time.
 * - A question shown only by a later answer comes right after the step whose
 *   answer shows it; then the path goes on where it was going, unless the
 *   question's own jump leads elsewhere. Questions a jump passes over are not
 *   on the path.
 *
 * A pure function of the answers, so going Back and changing an answer
 * changes the path the same way it changes where the form goes.
 */
export function pathOf(
  visible: ReadonlyArray<Question>,
  answers: LooseAnswers,
  others = otherIndex(visible),
  areas = areaIndex(visible),
  keep: LooseAnswers = {},
): Path {
  const on = new Set<number>();
  // Steps passed while shown only by an answer the path hadn't reached yet.
  const later: number[] = [];
  let i = 0;
  // `back`: where the path goes on after a step a later answer showed.
  for (let back = -1; i < visible.length && !on.has(i); ) {
    const q = visible[i]!;
    // What had been given by step i.
    const k = { ...answers };
    visible.forEach((v, j) => {
      if (j > i && !on.has(j) && !(v.id in keep)) delete k[v.id];
    });
    if (back < 0 && !shows(q, k, others, areas)) {
      later.push(i++);
      continue;
    }
    on.add(i);
    if (q.type === 'thanks') break;
    const jump = resolveJumpTarget(q, visible, k, others, areas);
    i = jump !== null && jump !== i ? jump : back < 0 ? i + 1 : back;
    // A step this answer shows comes first, then on to `i`.
    back = later.findIndex((j) => !isChrome(visible[j]!) && shows(visible[j]!, k, others, areas));
    if (back >= 0) [i, back] = [later.splice(back, 1)[0]!, i];
  }
  return Object.assign([...on], { next: i });
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
  keep?: LooseAnswers,
): LooseAnswers {
  const out: LooseAnswers = {};
  for (const i of pathOf(visible, allAnswers, others, areas, keep)) {
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
