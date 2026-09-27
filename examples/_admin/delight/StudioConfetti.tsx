/**
 * A small confetti burst for studio moments (ADR-060) — the "First
 * response!" toast. It reuses the engine's pass-1 confetti (ADR-059): the
 * same `.slate-confetti` / `.slate-confetti-piece` classes, so the same
 * `slate-confetti-burst` keyframes, piece shapes and reduced-motion gate from
 * src/styles/motion.css. Only the layout is its own (a tighter fan that fits
 * above a toast) and the colours come from studio chrome tokens (delight.css).
 * Fixed, not random, like the engine's.
 */

'use client';

import type { CSSProperties } from 'react';
import '@/styles/motion.css';

const PIECES: ReadonlyArray<{ x: number; y: number; r: number; d: number }> = [
  { x: -96, y: -40, r: 220, d: 0 },
  { x: -74, y: -78, r: -160, d: 30 },
  { x: -46, y: -104, r: 300, d: 10 },
  { x: -14, y: -118, r: -240, d: 50 },
  { x: 18, y: -110, r: 180, d: 20 },
  { x: 50, y: -96, r: -300, d: 40 },
  { x: 80, y: -70, r: 260, d: 0 },
  { x: 104, y: -36, r: -200, d: 60 },
  { x: -112, y: -8, r: 160, d: 70 },
  { x: 118, y: -4, r: -260, d: 80 },
  { x: -40, y: -58, r: 120, d: 90 },
  { x: 44, y: -52, r: -120, d: 100 },
];

export function StudioConfetti({ className }: { className?: string }) {
  return (
    <span className={`slate-confetti${className ? ` ${className}` : ''}`} aria-hidden="true">
      {PIECES.map((p, i) => (
        <i
          key={i}
          className="slate-confetti-piece"
          style={
            {
              '--slate-cf-x': `${p.x}px`,
              '--slate-cf-y': `${p.y}px`,
              '--slate-cf-r': `${p.r}deg`,
              '--slate-cf-delay': `${p.d}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
