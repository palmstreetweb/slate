/**
 * The editor's live preview must not take the keyboard from the owner (S15).
 *
 * Engine fields focus themselves a moment after they appear (brief §10.5),
 * which is right for a respondent and wrong beside the inspector: picking a
 * question in the outline, then typing in Title, sent the rest of the word
 * into the preview's answer box. Here, focus that lands in the preview
 * without a click, tap or Tab into it goes straight back to where it came
 * from. Clicking into the preview, or tabbing to it, works as before.
 *
 * Studio only: the engine is unchanged (no core bytes).
 */

import { useEffect, useMemo, useRef, type FocusEvent } from 'react';

/** How long after a click or key press a focus still counts as the owner's. */
const OWN_FOCUS_MS = 1000;

export function usePreviewFocusGuard() {
  const lastIntent = useRef(0);

  // Tab into the preview is the owner's own move, wherever it starts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') lastIntent.current = Date.now();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return useMemo(() => {
    const mark = () => {
      lastIntent.current = Date.now();
    };
    return {
      onPointerDownCapture: mark,
      onKeyDownCapture: mark,
      onFocusCapture: (e: FocusEvent<HTMLElement>) => {
        const from = e.relatedTarget as HTMLElement | null;
        if (!from || e.currentTarget.contains(from)) return;
        if (Date.now() - lastIntent.current < OWN_FOCUS_MS) return;
        from.focus({ preventScroll: true });
      },
    };
  }, []);
}
