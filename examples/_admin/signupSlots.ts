/**
 * Sign-up slots in the studio (ADR-066): fresh slot keys, and the roster —
 * who holds or waits for each slot — built from the responses the studio has
 * loaded. The database counts spots from the same answers (migration 020's
 * trigger), so what the roster shows is what the fill page is told is left.
 */

import type { SignupSlot, SignupSlotsQuestion } from '@/index.js';
import { SLOT_VALUE_RE, signupPicks } from '@/logic/signup.js';
import { offeredSlots, slotName } from '@/logic/signupView.js';
import type { StoredSubmission } from './_submissionStore.js';

/**
 * A new slot key: `s_` and six random letters/digits, never one already in
 * the list. Keys are never derived from the label (a rename keeps the key)
 * and never reused, so a new slot can't inherit an old slot's people.
 */
export function newSlotValue(existing: ReadonlyArray<string>): string {
  const taken = new Set(existing);
  for (;;) {
    const v = `s_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (!taken.has(v) && SLOT_VALUE_RE.test(v)) return v;
  }
}

export type RosterEntry = { sub: StoredSubmission; name: string };

export type RosterSlot = {
  /** The slot as the question offers it now; undefined for a key that's no longer offered. */
  slot: SignupSlot | undefined;
  value: string;
  name: string;
  capacity: number;
  /** Took a spot, oldest first. */
  taken: RosterEntry[];
  /** Joined the waitlist, oldest first (first in line first). */
  waiting: RosterEntry[];
};

/**
 * The roster of a sign-up question over live responses: every offered slot
 * in order, then any key people hold that the question no longer offers
 * (a removed slot), so nobody drops out of sight.
 */
export function signupRoster(
  question: SignupSlotsQuestion,
  subs: ReadonlyArray<StoredSubmission>,
  nameOf: (sub: StoredSubmission) => string,
): RosterSlot[] {
  const offered = offeredSlots(question);
  const byValue = new Map<string, RosterSlot>();
  for (const s of offered) {
    byValue.set(s.value, {
      slot: s,
      value: s.value,
      name: slotName(s),
      capacity: s.capacity,
      taken: [],
      waiting: [],
    });
  }
  const oldestFirst = [...subs].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const sub of oldestFirst) {
    const { slots, wait } = signupPicks(sub.answers[question.id]);
    const entry = { sub, name: nameOf(sub) };
    const row = (value: string): RosterSlot => {
      let r = byValue.get(value);
      if (!r) {
        r = { slot: undefined, value, name: value, capacity: 0, taken: [], waiting: [] };
        byValue.set(value, r);
      }
      return r;
    };
    for (const v of new Set(slots)) row(v).taken.push(entry);
    for (const v of new Set(wait)) if (!slots.includes(v)) row(v).waiting.push(entry);
  }
  return [...byValue.values()];
}

/** Spots taken per offered slot value (the inspector's "3 signed up"). */
export function takenCounts(
  question: SignupSlotsQuestion,
  subs: ReadonlyArray<StoredSubmission>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const sub of subs) {
    for (const v of new Set(signupPicks(sub.answers[question.id]).slots)) {
      out.set(v, (out.get(v) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Spots left per slot for a sign-up question, from the responses this browser
 * holds — the studio's test run and local mode, where no server counts them.
 */
export function localSlotsLeft(
  questions: ReadonlyArray<{ id: string; type: string }>,
  subs: ReadonlyArray<StoredSubmission>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const q of questions) {
    if (q.type !== 'signup_slots') continue;
    const question = q as SignupSlotsQuestion;
    const taken = takenCounts(question, subs);
    const left: Record<string, number> = {};
    for (const s of offeredSlots(question)) {
      left[s.value] = Math.max(0, s.capacity - (taken.get(s.value) ?? 0));
    }
    out[q.id] = left;
  }
  return out;
}

/** "Sat 10–11am", "Sat 10–11am and Sun 2–3pm", "Sat 10–11am, Sun 2–3pm and Mon 9am". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the respondent reads when a slot they picked filled up during the
 * submit (ADR-066), in the page's own words and with the slots' own names.
 */
export function slotFullMessage(
  questions: ReadonlyArray<{ id: string; type: string }>,
  full: ReadonlyArray<{ question: string; slot: string }>,
): string {
  const names: string[] = [];
  let waitlist = false;
  for (const f of full) {
    const q = questions.find((x) => x.id === f.question) as SignupSlotsQuestion | undefined;
    if (!q || q.type !== 'signup_slots') continue;
    waitlist ||= q.waitlist === true;
    const name = slotName(q.slots?.find((s) => s.value === f.slot));
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
