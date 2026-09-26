/**
 * Top-edge progress bar. `value` is the percentage 0–100.
 *
 * The fill moves by `transform: scaleX()` (compositor-only, ADR-059) and a
 * glowing tip rides its leading edge, flaring when the respondent moves
 * forward. `complete` marks a confirmed submit: the tip gives one last big
 * flare and rests hidden. Calm motion: no transitions, no tip.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion.js';
import { flareProgressTip } from '@/utils/motion.js';

type Props = { value: number; complete?: boolean };

export function ProgressBar({ value, complete = false }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const reducedMotion = useReducedMotion();
  const tipRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(clamped);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = clamped;
    if (reducedMotion || clamped <= prev) return;
    flareProgressTip(tipRef.current, complete && clamped >= 100);
  }, [clamped, complete, reducedMotion]);

  return (
    <div
      className={`slate-progress${complete ? ' slate-progress--complete' : ''}`}
      role="progressbar"
      aria-label="Form progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      {...(clamped <= 0 ? { 'data-empty': '' } : {})}
    >
      <div className="slate-progress-bar" style={{ transform: `scaleX(${clamped / 100})` }} />
      <div
        className="slate-progress-spark"
        aria-hidden="true"
        style={{ transform: `translateX(${clamped - 100}%)` }}
      >
        <span ref={tipRef} className="slate-progress-tip" />
      </div>
    </div>
  );
}
