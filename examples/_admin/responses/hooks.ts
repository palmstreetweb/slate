/**
 * Small browser hooks shared by the Responses page and views (ADR-055):
 * the phone breakpoint (studio-zoom aware), pointer type, a ticking clock
 * for relative ages, the guard for single-key shortcuts, and "Mark all
 * read" with its Undo toast.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { readUiScale, UI_SCALE_EVENT } from '../uiScale.js';
import { useToast } from '../toast.js';

/** Widest CSS width (at 1× studio size) that gets the phone layout. */
export const PHONE_MAX_WIDTH = 719;
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

const ZOOM_BY_SCALE = { 1: 1, 2: 1.1, 3: 1.2 } as const;

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const get = useCallback(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches),
    [query],
  );
  return useSyncExternalStore(subscribe, get, () => false);
}

function subscribeScale(onChange: () => void): () => void {
  window.addEventListener(UI_SCALE_EVENT, onChange);
  return () => window.removeEventListener(UI_SCALE_EVENT, onChange);
}

/** The studio size zoom (1, 1.1 or 1.2 — ADR-045), kept live. */
export function useStudioZoom(): number {
  const scale = useSyncExternalStore(subscribeScale, readUiScale, () => 1 as const);
  return ZOOM_BY_SCALE[scale];
}

/**
 * True when the page has less than 720 CSS px to work with. The studio
 * size setting zooms the whole studio, so at 1.2× a 800px window is a
 * phone-width page; the breakpoint scales with it. The page adds
 * `.slate-rsp--phone` from this, so CSS and JS agree.
 */
export function usePhone(): boolean {
  const zoom = useStudioZoom();
  const max = Math.floor((PHONE_MAX_WIDTH + 1) * zoom) - 1;
  return useMediaQuery(`(max-width: ${max}px)`);
}

/** Mouse or trackpad: show keycap hints. */
export function useFinePointer(): boolean {
  return useMediaQuery(FINE_POINTER_QUERY);
}

/** `new Date()` that refreshes every `intervalMs` so "2m" ages stay honest. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/** A dialog, alert or menu is open somewhere on the page. */
export function isOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]',
    ),
  );
}

/**
 * Single-key shortcuts (j, k, u, /…) stay out of the way: not while typing,
 * not with a modifier held, not while a dialog or menu is open.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  if (isTypingTarget(e.target)) return true;
  return isOverlayOpen();
}

/**
 * "Mark all read", the same in both views: one write, then a toast whose
 * Undo puts those responses back to unread in their original order.
 */
export function useMarkAllRead(
  onMarkRead: (ids: string[]) => void,
  onMarkUnread: (id: string) => void,
): (ids: ReadonlyArray<string>) => void {
  const toast = useToast();
  return useCallback(
    (ids: ReadonlyArray<string>) => {
      if (ids.length === 0) return;
      const marked = [...ids];
      onMarkRead(marked);
      toast.push({
        title: `Marked ${marked.length} as read`,
        action: {
          label: 'Undo',
          // markUnread prepends, so walk backwards to keep the original order.
          onClick: () => {
            for (let i = marked.length - 1; i >= 0; i--) onMarkUnread(marked[i]!);
          },
        },
      });
    },
    [toast, onMarkRead, onMarkUnread],
  );
}
