/**
 * The instant estimate on the Thank You screen (ADR-064). Loaded on demand
 * (only forms with an ending that shows an estimate download it).
 *
 * The reveal follows the delight motion rules (ADR-059/060): the range counts
 * up from zero over ~0.9 s with an ease-out, the breakdown lines rise in one
 * after another, and the small print fades in last. The true figure is always
 * in the DOM as screen-reader text; only an aria-hidden copy animates. Calm
 * motion (OS setting or the wrapper's `data-reduced-motion`) shows the final
 * numbers at once.
 */

'use client';

import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Estimate, EstimateSettings } from '@/types/Estimate.js';
import {
  estimateFraction,
  formatEstimate,
  formatMoney,
  formatMoneyRange,
} from '@/logic/estimate.js';
import { motionReduced } from '@/utils/motion.js';
import '@/styles/extensions.css';

const COUNT_MS = 900;

/** easeOutCubic — fast start, soft landing (the studio's CountUp curve). */
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** 0 → 1 over `ms`, or 1 at once under calm motion. */
function useProgress(ref: React.RefObject<HTMLElement | null>, ms: number): number {
  const [p, setP] = useState(0);
  useLayoutEffect(() => {
    if (motionReduced(ref.current) || typeof window.requestAnimationFrame !== 'function') {
      setP(1);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setP(ease(t));
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [ref, ms]);
  return p;
}

type Props = { estimate: Estimate; settings?: EstimateSettings };

export default function EstimateReveal({ estimate, settings }: Props) {
  const ref = useRef<HTMLElement>(null);
  const labelId = useId();
  const p = useProgress(ref, COUNT_MS);
  const fraction = estimateFraction(estimate);
  const { currency } = estimate;
  const label = settings?.label?.trim() || 'Your estimate';
  const disclaimer = settings?.disclaimer?.trim();
  const lines = settings?.breakdown ? estimate.lines : [];
  const range = estimate.high > estimate.low;
  // Whole units while counting; the exact figure lands on the last frame.
  const shown = (n: number) =>
    formatMoney(p >= 1 ? n : Math.round(n * p), currency, p >= 1 ? fraction : 0);

  return (
    <section ref={ref} className="slate-estimate" aria-labelledby={labelId}>
      <p id={labelId} className="slate-estimate-label">
        {label}
      </p>
      <p className="slate-estimate-total">
        <span className="slate-sr">{formatEstimate(estimate)}</span>
        <span aria-hidden="true" className="slate-estimate-figure">
          <span>{shown(estimate.low)}</span>
          {range ? (
            <>
              <span className="slate-estimate-dash"> – </span>
              <span>{shown(estimate.high)}</span>
            </>
          ) : null}
        </span>
      </p>
      {lines.length > 0 ? (
        <ul className="slate-estimate-lines">
          {lines.map((line, i) => (
            <li
              key={`${line.id}-${i}`}
              className="slate-estimate-line"
              style={{ '--slate-i': i } as CSSProperties}
            >
              <span className="slate-estimate-line-label">
                {line.label}
                {line.qty !== undefined ? (
                  <span className="slate-estimate-qty"> × {line.qty}</span>
                ) : null}
              </span>
              <span className="slate-estimate-line-amount">
                {formatMoneyRange(line.low, line.high, currency, fraction)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {disclaimer ? <p className="slate-estimate-note">{disclaimer}</p> : null}
    </section>
  );
}
