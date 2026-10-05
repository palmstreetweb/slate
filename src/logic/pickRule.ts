/**
 * A multiple-pick question's rule in words (multi choice, picture choice with
 * `multiple`, swipe cards). Pure, no React. Only the on-demand fields use it,
 * so it stays out of the engine's core; the limits themselves are
 * `pickLimits` in validation.ts, which the core needs.
 */

import { pickLimits, type PickRule } from './validation.js';

/** The choices on offer, Other included. */
export function pickChoices(q: PickRule): number {
  return q.options.length + (q.allowOther ? 1 : 0);
}

/**
 * "Pick up to 3", "Pick at least 2", "Pick 2", "Pick at least 1, up to 3",
 * "Pick as many as you like" — shown above the choices, so the rule is known
 * before the first tap. `verb` is "Like" on swipe cards.
 */
export function pickHint(q: PickRule, verb = 'Pick'): string {
  const [min, max] = pickLimits(q);
  if (min === max) return `${verb} ${min}`;
  const parts = [min > 0 && `at least ${min}`, max < pickChoices(q) && `up to ${max}`];
  return `${verb} ${parts.filter(Boolean).join(', ') || 'as many as you like'}`;
}
