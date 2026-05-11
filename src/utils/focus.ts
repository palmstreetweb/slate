/** Focus management helpers for the form engine. */

/**
 * Schedule focus on the given element after a short delay so that focus
 * arrives in the middle of the question's enter transition (per brief §10.5).
 * Returns a cancel function callers can invoke from a cleanup callback.
 */
export function focusAfter(element: HTMLElement | null, delayMs = 380): () => void {
  if (!element || typeof window === 'undefined') return () => {};
  const id = window.setTimeout(() => {
    element.focus({ preventScroll: true });
  }, delayMs);
  return () => window.clearTimeout(id);
}
