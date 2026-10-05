/** Focus management helpers for the form engine. */

/**
 * Schedule focus on the given element after a short delay so that focus
 * arrives in the middle of the question's enter transition (per brief §10.5).
 * Returns a cancel function callers can invoke from a cleanup callback.
 *
 * While the field is up, a phone keyboard opening (the visual viewport
 * shrinking) brings the question's OK row, and any message just above it,
 * back into view instead of leaving them under the keyboard (GAP-04).
 */
export function focusAfter(element: HTMLElement | null, delayMs = 380): () => void {
  if (!element || typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  // A keyboard changes only the height; a pinch-zoom changes the width too,
  // and is left alone (no yanking a zoomed-in reader back to OK).
  const width = vv?.width;
  const reveal = () =>
    vv?.width === width &&
    element
      .closest('.slate-stage-content')
      ?.querySelector('.slate-actions')
      ?.scrollIntoView?.({ block: 'nearest' });
  const id = setTimeout(() => element.focus({ preventScroll: true }), delayMs);
  vv?.addEventListener('resize', reveal);
  return () => {
    clearTimeout(id);
    vv?.removeEventListener('resize', reveal);
  };
}
