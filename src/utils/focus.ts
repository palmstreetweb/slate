/** Focus management helpers for the form engine. */

/**
 * Schedule focus on the given element after a short delay so that focus
 * arrives in the middle of the question's enter transition (per brief §10.5).
 * Returns a cancel function callers can invoke from a cleanup callback. Not
 * inside `[data-slate-preview]`: a preview beside an editor (the studio's live
 * preview) must never take the keyboard from the fields being edited (S4, S15).
 *
 * While the field is up, a phone keyboard opening brings the question's OK
 * row, and any message just above it, back into view instead of leaving them
 * under the keyboard (GAP-04). Only a keyboard: a text box in this question
 * took focus, and since then the visual viewport has lost more than 150 px of
 * its height at the same width; once per focus. A browser's toolbar sliding
 * in or out (a smaller change), the viewport growing, a rotation or a
 * pinch-zoom (the width changes too) never move the page.
 */
export function focusAfter(element: HTMLElement | null, delayMs = 380): () => void {
  if (!element || typeof window === 'undefined') return () => {};
  const vv = window.visualViewport;
  const stage = element.closest('.slate-stage-content') ?? element;
  // The viewport when a text box here took focus; h is 0 when none has it.
  let h = 0;
  let w = 0;
  const onFocus = (e: Event) => {
    h = vv && (e.target as Element).matches('input,textarea') ? vv.height : 0;
    w = vv?.width ?? 0;
  };
  const onResize = () => {
    if (vv!.width === w && h - vv!.height > 150) {
      h = 0;
      stage.querySelector('.slate-actions')?.scrollIntoView?.({ block: 'nearest' });
    }
  };
  const id = setTimeout(
    () => element.closest('[data-slate-preview]') || element.focus({ preventScroll: true }),
    delayMs,
  );
  stage.addEventListener('focusin', onFocus);
  vv?.addEventListener('resize', onResize);
  return () => {
    clearTimeout(id);
    stage.removeEventListener('focusin', onFocus);
    vv?.removeEventListener('resize', onResize);
  };
}
