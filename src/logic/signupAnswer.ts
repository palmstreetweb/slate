/**
 * The small part of sign-up slots (ADR-066) the engine's core needs: reading
 * an answer's picks, and the waitlist sentinel for conditions. The slot rules
 * shared with the server live in signup.ts, which only the on-demand field,
 * the studio and the submit Function import (it stays out of the core bundle).
 */

/**
 * In a condition's value on a sign-up question: "joined a waitlist". Compared
 * in `conditional.ts`, never stored. A slot's own value means "took that slot".
 */
export const WAITLIST_VALUE = '__waitlist__';

/** The taken and waitlisted slot values of an answer (empty lists for anything else). */
export function signupPicks(v: unknown): { slots: string[]; wait: string[] } {
  const a = (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {}) as {
    slots?: unknown;
    wait?: unknown;
  };
  const list = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  return { slots: list(a.slots), wait: list(a.wait) };
}
