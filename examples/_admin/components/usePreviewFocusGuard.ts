/**
 * The editor's live preview must not take the keyboard from the owner (S15).
 *
 * Engine fields focus themselves a moment after they appear (brief §10.5),
 * which is right for a respondent and wrong beside the inspector: picking a
 * question in the outline, then typing in Title, sent the rest of the word
 * into the preview's answer box. The live preview now turns that off
 * (`data-slate-preview`, which the engine's `focusAfter` reads); this guard
 * stays for any other focus a field moves by itself. Focus that lands in the
 * preview without a click, tap or Tab into it goes straight back to where it
 * came from. Clicking into the preview, or tabbing to it, works as before.
 *
 * A Tab counts only for the focus it moves at once: a Tab to an outline row,
 * then Enter, is the owner staying on the outline (S15 retest).
 */

import { useEffect, useMemo, useRef, type FocusEvent } from 'react';

/** How long after a click or key press inside the preview a focus still counts as the owner's. */
const OWN_FOCUS_MS = 1000;
/** A Tab moves focus straight away: only a focus this soon after one is that Tab's. */
const TAB_FOCUS_MS = 100;

export function usePreviewFocusGuard() {
  const lastIntent = useRef(0);
  const lastTab = useRef(0);

  // Tab into the preview is the owner's own move, wherever it starts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') lastTab.current = Date.now();
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
        const now = Date.now();
        if (now - lastIntent.current < OWN_FOCUS_MS || now - lastTab.current < TAB_FOCUS_MS) return;
        from.focus({ preventScroll: true });
      },
    };
  }, []);
}
