/**
 * A form's very first response gets a one-time celebration (ADR-060).
 *
 * "First" means: every active response the form has is new to this browser
 * in this ingest, so nothing of it was known before. Once shown, the form id
 * is remembered per browser under `slate-admin-first-response` so it never
 * fires twice, even after a trash-and-restore or a second tab. Every storage
 * access is wrapped: private mode or a full quota just means the moment might
 * repeat, never an error.
 */

export const FIRST_RESPONSE_KEY = 'slate-admin-first-response';
/** Plenty for one owner; the oldest ids fall off first. */
const CAP = 500;

function readCelebrated(): string[] {
  try {
    const raw = window.localStorage.getItem(FIRST_RESPONSE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function hasCelebratedFirst(formId: string): boolean {
  return readCelebrated().includes(formId);
}

export function markFirstCelebrated(formIds: ReadonlyArray<string>): void {
  if (formIds.length === 0) return;
  try {
    const next = [...formIds, ...readCelebrated().filter((id) => !formIds.includes(id))];
    window.localStorage.setItem(FIRST_RESPONSE_KEY, JSON.stringify(next.slice(0, CAP)));
  } catch {
    // Private mode / quota — the worst case is one more celebration.
  }
}

/**
 * Forms whose whole active response list is inside `fresh`, not yet
 * celebrated, in the order their first fresh response appears. Pure apart
 * from the celebrated-list read.
 */
export function firstResponseForms(
  fresh: ReadonlyArray<string>,
  index: ReadonlyArray<{ id: string; formId: string }>,
): string[] {
  if (fresh.length === 0) return [];
  const freshSet = new Set(fresh);
  const seenBefore = new Set<string>();
  const order: string[] = [];
  for (const entry of index) {
    if (!freshSet.has(entry.id)) seenBefore.add(entry.formId);
    else if (!order.includes(entry.formId)) order.push(entry.formId);
  }
  const celebrated = new Set(readCelebrated());
  return order.filter((formId) => !seenBefore.has(formId) && !celebrated.has(formId));
}
