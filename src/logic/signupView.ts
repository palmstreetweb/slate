/**
 * Sign-up slots (ADR-066): how slots read on the fill page and in the studio.
 * Pure, no React, no Intl (English copy, same text on every device, like
 * dateValue.ts). Kept out of the engine's core: only the on-demand field and
 * the studio import it.
 */

import type { SignupSlot, SignupSlotsQuestion } from '@/types/Question.js';
import { isValidIsoDate, isValidTime } from './dateValue.js';
import { signupPicks, signupSlotsOf } from './signup.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The slots a question offers (see `signupSlotsOf`), with everything the owner set on each. */
export function offeredSlots(q: SignupSlotsQuestion): SignupSlot[] {
  const raw = Array.isArray(q.slots) ? q.slots : [];
  return signupSlotsOf(q as unknown as Record<string, unknown>).map(
    (spec) => raw.find((s) => s.value === spec.value && s.capacity === spec.capacity)!,
  );
}

/** "Saturday, October 4" for `2026-10-04`, or '' when it isn't a real date. */
export function slotDayLabel(date: string | undefined): string {
  if (!date || !isValidIsoDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d).getDay();
  return `${DAYS[day]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Sat, Oct 4" — the short form for lists and exports. */
export function slotDayShort(date: string | undefined): string {
  if (!date || !isValidIsoDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d).getDay();
  return `${DAYS[day]!.slice(0, 3)}, ${MONTHS[m - 1]!.slice(0, 3)} ${d}`;
}

function clock(t: string): { text: string; half: 'AM' | 'PM' } {
  const [h, min] = t.split(':').map(Number) as [number, number];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    text: min === 0 ? String(h12) : `${h12}:${String(min).padStart(2, '0')}`,
    half: h < 12 ? 'AM' : 'PM',
  };
}

/** "10–11 AM", "11:30 AM – 1 PM", "9 AM" — '' when there is no valid start. */
export function slotTimeText(slot: Pick<SignupSlot, 'start' | 'end'>): string {
  if (!slot.start || !isValidTime(slot.start)) return '';
  const a = clock(slot.start);
  if (!slot.end || !isValidTime(slot.end) || slot.end === slot.start) return `${a.text} ${a.half}`;
  const b = clock(slot.end);
  return a.half === b.half
    ? `${a.text}–${b.text} ${b.half}`
    : `${a.text} ${a.half} – ${b.text} ${b.half}`;
}

/** "Sat, Oct 4 · 10–11 AM" (either part may be missing). */
export function slotWhenText(slot: Pick<SignupSlot, 'date' | 'start' | 'end'>): string {
  return [slotDayShort(slot.date), slotTimeText(slot)].filter(Boolean).join(' · ');
}

/** The slot's name: its label, else when it is, else its key. */
export function slotName(slot: SignupSlot | undefined, fallback = ''): string {
  if (!slot) return fallback;
  return slot.label?.trim() || slotWhenText(slot) || slot.value || fallback;
}

/** Consecutive slots on the same day, each group with its day label ('' for undated). */
export function slotDays(
  slots: ReadonlyArray<SignupSlot>,
): Array<{ day: string; slots: SignupSlot[] }> {
  const out: Array<{ day: string; slots: SignupSlot[] }> = [];
  for (const s of slots) {
    const day = slotDayLabel(s.date);
    const last = out[out.length - 1];
    if (last && last.day === day) last.slots.push(s);
    else out.push({ day, slots: [s] });
  }
  return out;
}

/** Spots left as the host reported them, clamped to 0…capacity; undefined when unknown. */
export function spotsLeft(
  left: Readonly<Record<string, number>> | undefined,
  slot: Pick<SignupSlot, 'value' | 'capacity'>,
): number | undefined {
  if (!left || !Object.prototype.hasOwnProperty.call(left, slot.value)) return undefined;
  const n = left[slot.value];
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(slot.capacity, Math.floor(n)));
}

/** "3 of 8 left", "1 spot left", "Full", or the capacity when the count is unknown. */
export function remainingText(left: number | undefined, capacity: number): string {
  if (left === undefined) return `${capacity} ${capacity === 1 ? 'spot' : 'spots'}`;
  if (left <= 0) return 'Full';
  if (left === 1) return '1 spot left';
  return `${left} of ${capacity} left`;
}

/**
 * Move a respondent in a sign-up answer (the studio's roster, ADR-066): out of
 * `from` (a slot they hold or wait for) and into `to` as a taken spot, added
 * last. `from === to` takes a waitlisted person into that slot. The
 * database's move_signup_slot() makes the same change.
 */
export function moveSignupAnswer(
  v: unknown,
  from: string,
  to: string,
): { slots: string[]; wait?: string[] } {
  const { slots, wait } = signupPicks(v);
  const nextSlots = [...slots.filter((s) => s !== from && s !== to), to];
  const nextWait = wait.filter((s) => s !== from && s !== to);
  return nextWait.length ? { slots: nextSlots, wait: nextWait } : { slots: nextSlots };
}
