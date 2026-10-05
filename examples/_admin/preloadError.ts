/**
 * What the app does when a lazily loaded part fails to download
 * (`vite:preloadError`), kept out of the entry so it can be tested.
 *
 * Studio: a redeploy replaces hashed chunks, and an open tab that lazy-loads
 * an old one would white-screen — reload once to pick up the new build,
 * never loop (ADR-046).
 *
 * Respondent pages (the public fill link, portable links): never (X2). A
 * Wi-Fi blip while a question's part downloads would reload mid-form and wipe
 * every answer. The import fails as it is, and that part shows its own "Try
 * again" (the answers are kept in the tab across it, ADR-017 addendum).
 */

const RELOADED_KEY = 'slate-reloaded-for-deploy';

/** True when the page reloads; false when the failed import is left to reject. */
export function handlePreloadError(
  event: Pick<Event, 'preventDefault'>,
  respondent: boolean,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  reload: () => void,
): boolean {
  if (respondent) return false;
  try {
    if (!storage || storage.getItem(RELOADED_KEY) === '1') return false;
    storage.setItem(RELOADED_KEY, '1');
  } catch {
    // Storage off: no way to remember a reload, so none — a failing part can't loop.
    return false;
  }
  // Only now: a prevented event makes the import resolve to nothing instead of failing.
  event.preventDefault();
  reload();
  return true;
}
