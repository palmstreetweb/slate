/**
 * The fill page's side of a slot that filled during the submit (ADR-066): the
 * message the respondent reads, and fresh counts merged over the page's own.
 * Kept apart from signupSlots.ts so the respondent's bundle doesn't carry the
 * studio's roster code.
 */

import type { Question, SignupSlotsQuestion } from '@/index.js';

/** "Sat 10–11am", "Sat 10–11am and Sun 2–3pm", "Sat 10–11am, Sun 2–3pm and Mon 9am". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the respondent reads when a slot they picked filled up during the
 * submit, in the page's own words and with the slots' own names (a slot
 * without a name — schemaCheck warns — reads "A spot you picked").
 */
export function slotFullMessage(
  questions: ReadonlyArray<Question>,
  full: ReadonlyArray<{ question: string; slot: string }>,
): string {
  const names: string[] = [];
  let waitlist = false;
  for (const f of full) {
    const found = questions.find((x) => x.id === f.question);
    if (found?.type !== 'signup_slots') continue;
    const q: SignupSlotsQuestion = found;
    waitlist ||= q.waitlist === true;
    const name = q.slots?.find((s) => s.value === f.slot)?.label?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  const what = names.length ? joinNames(names) : 'A spot you picked';
  const verb = names.length > 1 ? 'filled up' : 'just filled up';
  return `${what} ${verb} while you were answering. Please pick another${waitlist ? ' or join its waitlist' : ''} — your other answers are saved.`;
}

/** Fresh counts over the ones the page has (a partial update keeps the rest). */
export function mergeSlotsLeft(
  cur: Record<string, Record<string, number>> | undefined,
  next: Record<string, Record<string, number>> | undefined | null,
): Record<string, Record<string, number>> | undefined {
  if (!next) return cur;
  const out: Record<string, Record<string, number>> = { ...(cur ?? {}) };
  for (const [q, per] of Object.entries(next)) out[q] = { ...(out[q] ?? {}), ...per };
  return out;
}
