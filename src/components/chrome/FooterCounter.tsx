/**
 * "n / m" badge anchored to the bottom-right corner of the form. The current
 * number rolls up to the next one (down when going back); motion.css owns
 * the roll and turns it off for calm motion (ADR-059).
 */

'use client';

import { useState } from 'react';

type Props = { current: number; total: number };

export function FooterCounter({ current, total }: Props) {
  const safeCurrent = Math.max(0, Math.min(current, total));
  const [shown, setShown] = useState(safeCurrent);
  const [direction, setDirection] = useState<'up' | 'down'>('up');

  // Derive the roll direction from the previous number during render, so
  // the new digit mounts with the right animation in the same frame.
  if (safeCurrent !== shown) {
    setDirection(safeCurrent > shown ? 'up' : 'down');
    setShown(safeCurrent);
  }

  if (total <= 0) return null;
  return (
    <div className="slate-footer" aria-live="off">
      <span className="slate-footer-roll">
        <span key={safeCurrent} className="slate-footer-num" data-roll={direction}>
          {safeCurrent}
        </span>
      </span>
      {' '}/ {total}
    </div>
  );
}
