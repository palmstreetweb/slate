/**
 * Reveal-on-view (ADR-060): tags an element `data-reveal="pending"` until it
 * scrolls into view, then `data-reveal="in"` — CSS in delight.css grows the
 * Summary bars from zero on that flip. One shared IntersectionObserver.
 *
 * The attribute is set on the DOM directly (never through React props), so
 * re-renders of a memoised card don't reset it and the bars grow only once.
 * Without IntersectionObserver, or with calm motion, the element is marked
 * `in` straight away (its static, fully drawn state).
 */

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionReduced } from '@/utils/motion.js';

let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!shared) {
    shared = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = 'in';
          shared?.unobserve(entry.target);
        }
      },
      // A sliver of the card is enough; don't wait for it to be centred.
      { rootMargin: '0px 0px -6% 0px', threshold: 0.12 },
    );
  }
  return shared;
}

export function useReveal<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Layout effect: "pending" must land before the first paint, or the bars
  // would flash in full and then snap back to zero.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.reveal === 'in') return undefined;
    const io = motionReduced(el) ? null : observer();
    if (!io) {
      el.dataset.reveal = 'in';
      return undefined;
    }
    el.dataset.reveal = 'pending';
    io.observe(el);
    return () => io.unobserve(el);
  }, []);
  return ref;
}
