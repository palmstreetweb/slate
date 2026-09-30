/**
 * Sign-up slots (ADR-066) — pure, no React.
 *
 * The owner lists slots, each with a capacity ("Sat 10–11am, 8 spots"). The
 * answer is `{ slots: [value, …], wait?: [value, …] }`: the slots taken, in
 * the order picked, and the full slots whose waitlist the respondent joined.
 * The server takes each spot atomically at submit (migration 020), so a slot
 * never holds more than its capacity.
 *
 * `signupAnswerCore` is the canonical form of an answer against its question,
 * used by the engine's validation and re-run by the submit Function on what it
 * receives. The shared section is copied byte for byte into
 * neon/functions/submit-response/signup.ts (tests compare them), and
 * migration 020's `signup_slots_of()` applies `signupSlotsOf`'s rule in SQL.
 */

/* ---------- shared with the server (keep identical) ---------- */

/** Most slots one question offers; entries past this are ignored. */
export const SLOTS_MAX = 50;
/** Most spots in one slot. */
export const SLOT_CAPACITY_MAX = 1000;
/** A slot's stored value: letters, digits, `_` and `-`, up to 64 characters. */
export const SLOT_VALUE_RE = /^[A-Za-z0-9_-]{1,64}$/;

type SlotRecord = Record<string, unknown>;

/** A slot the question really offers: a valid value and a whole-number capacity. */
export type SlotSpec = { value: string; label: string; capacity: number };

function isSlotRecord(v: unknown): v is SlotRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The slots a question offers, in order: among its first SLOTS_MAX entries,
 * those with a valid value and a capacity from 1 to SLOT_CAPACITY_MAX, the
 * first of each value.
 */
export function signupSlotsOf(q: SlotRecord): SlotSpec[] {
  const out: SlotSpec[] = [];
  const seen = new Set<string>();
  const raw = Array.isArray(q.slots) ? q.slots.slice(0, SLOTS_MAX) : [];
  for (const s of raw) {
    if (!isSlotRecord(s)) continue;
    const { value, capacity } = s;
    if (typeof value !== 'string' || !SLOT_VALUE_RE.test(value) || seen.has(value)) continue;
    if (
      typeof capacity !== 'number' ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > SLOT_CAPACITY_MAX
    ) {
      continue;
    }
    seen.add(value);
    out.push({
      value,
      label: typeof s.label === 'string' ? s.label.trim().slice(0, 120) : '',
      capacity,
    });
  }
  return out;
}

/** Most slots one respondent may take (waitlists count): `maxPicks`, 1 by default, never more than offered. */
export function signupMaxPicks(q: SlotRecord, offered: number): number {
  const m = q.maxPicks;
  const n = typeof m === 'number' && Number.isInteger(m) && m >= 1 ? Math.min(m, SLOTS_MAX) : 1;
  return Math.max(1, Math.min(n, offered));
}

/**
 * The canonical answer: offered slot values only, each once, in the order
 * given; `wait` only when the question has a waitlist and never a slot that
 * is also taken; at most `signupMaxPicks` in all, taken slots first.
 * Undefined when nothing is left.
 */
export function signupAnswerCore(
  q: SlotRecord,
  v: unknown,
): { slots: string[]; wait?: string[] } | undefined {
  if (!isSlotRecord(v)) return undefined;
  const offered = new Set(signupSlotsOf(q).map((s) => s.value));
  const max = signupMaxPicks(q, offered.size);
  const keep = (list: unknown, skip: ReadonlyArray<string>): string[] => {
    const out: string[] = [];
    if (!Array.isArray(list)) return out;
    for (const x of list.slice(0, SLOTS_MAX)) {
      if (typeof x === 'string' && offered.has(x) && !skip.includes(x) && !out.includes(x)) {
        out.push(x);
      }
    }
    return out;
  };
  const slots = keep(v.slots, []).slice(0, max);
  const wait = q.waitlist === true ? keep(v.wait, slots).slice(0, max - slots.length) : [];
  if (slots.length === 0 && wait.length === 0) return undefined;
  return wait.length ? { slots, wait } : { slots };
}

/* ---------- engine-only helpers ---------- */

export { WAITLIST_VALUE, signupPicks } from './signupAnswer.js';
