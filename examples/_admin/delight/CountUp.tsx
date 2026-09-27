/**
 * A number that counts up to its value (ADR-060) — the Summary KPI tiles.
 *
 * The true value is always in the DOM as screen-reader text; only the
 * aria-hidden copy animates, so assistive tech never hears "3, 4, 5…".
 * It counts from 0 on mount and from the old value on a change, over about
 * 600 ms with an ease-out. Calm motion (OS setting or the wrapper's
 * `data-reduced-motion`) shows the value at once.
 */

'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { motionReduced } from '@/utils/motion.js';

export const COUNT_UP_MS = 600;

/** easeOutCubic — fast start, soft landing. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** The integer shown `elapsed` ms into a count from `from` to `to`. */
export function countFrame(
  from: number,
  to: number,
  elapsed: number,
  duration = COUNT_UP_MS,
): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return Math.round(from + (to - from) * easeOutCubic(elapsed / duration));
}

type Props = {
  value: number;
  durationMs?: number;
  className?: string;
  /** Screen-reader class; the studio's responses page uses `rsp-sr`. */
  srClassName?: string;
};

export function CountUp({
  value,
  durationMs = COUNT_UP_MS,
  className,
  srClassName = 'slate-sr',
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(0);
  const [shown, setShown] = useState(0);

  useLayoutEffect(() => {
    const from = shownRef.current;
    const set = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    if (
      from === value ||
      motionReduced(ref.current) ||
      typeof window.requestAnimationFrame !== 'function'
    ) {
      set(value);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const n = countFrame(from, value, now - start, durationMs);
      if (n !== shownRef.current) set(n);
      if (n !== value) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className}>
      <span className={srClassName}>{value}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
