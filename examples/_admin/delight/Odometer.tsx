/**
 * Odometer count (ADR-060) — the dashboard card's response count rolls up
 * digit by digit when a new response lands, like a mechanical counter.
 *
 * At rest it is plain text. Only an increase after mount rolls: each changed
 * digit gets a reel from its old digit up to the new one (through 9 → 0 when
 * it wraps) that slides by `transform` only. The true number sits in
 * screen-reader text while the reels are aria-hidden. Calm motion, a
 * decrease or the first render never roll.
 */

'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motionReduced } from '@/utils/motion.js';

/** Longest reel kept per digit, so a big jump still reads as a quick roll. */
const MAX_REEL = 10;

/**
 * The reel for each digit of `to`, left to right. A digit that didn't change
 * is a one-item reel. A new leading digit starts blank (''). Pure.
 */
export function odometerReels(from: number, to: number): string[][] {
  const next = String(Math.max(0, Math.trunc(to)));
  const prev = String(Math.max(0, Math.trunc(from))).padStart(next.length, ' ');
  return next.split('').map((digit, i) => {
    const old = prev[i] ?? ' ';
    if (old === digit) return [digit];
    const reel: string[] = [];
    if (old === ' ') {
      reel.push('');
      for (let d = 1; d <= Number(digit); d += 1) reel.push(String(d));
    } else {
      let d = Number(old);
      reel.push(String(d));
      while (String(d) !== digit && reel.length < 11) {
        d = (d + 1) % 10;
        reel.push(String(d));
      }
    }
    // Keep the first and the last MAX_REEL - 1, so long reels stay quick.
    return reel.length > MAX_REEL ? [reel[0]!, ...reel.slice(-(MAX_REEL - 1))] : reel;
  });
}

type Roll = { from: number; to: number; key: number };

export function Odometer({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const [roll, setRoll] = useState<Roll | null>(null);

  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (value > from && !motionReduced(ref.current)) {
      setRoll({ from, to: value, key: Date.now() });
    } else if (value !== from) {
      setRoll(null);
    }
  }, [value]);

  const cls = `slate-odo${className ? ` ${className}` : ''}`;
  if (!roll || roll.to !== value) {
    return (
      <span ref={ref} className={cls}>
        {value}
      </span>
    );
  }

  const reels = odometerReels(roll.from, roll.to);
  // Right-hand digits start first, so the leftmost changed reel ends last.
  const lastToFinish = reels.findIndex((r) => r.length > 1);
  return (
    <span ref={ref} className={`${cls} slate-odo--rolling`} key={roll.key}>
      <span className="slate-sr">{value}</span>
      <span className="slate-odo-digits" aria-hidden="true">
        {reels.map((reel, i) =>
          reel.length === 1 ? (
            <span key={i} className="slate-odo-col">
              <span className="slate-odo-digit">{reel[0]}</span>
            </span>
          ) : (
            <span key={i} className="slate-odo-col">
              <span
                className="slate-odo-reel"
                style={
                  {
                    '--odo-end': `${(-100 * (reel.length - 1)) / reel.length}%`,
                    '--odo-delay': `${(reels.length - 1 - i) * 70}ms`,
                  } as CSSProperties
                }
                onAnimationEnd={i === lastToFinish ? () => setRoll(null) : undefined}
              >
                {reel.map((d, j) => (
                  <span key={j} className="slate-odo-digit">
                    {d}
                  </span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  );
}
