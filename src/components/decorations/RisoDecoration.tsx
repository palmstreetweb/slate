/**
 * Riso decoration — a duotone halftone backdrop in the spirit of risograph
 * printing: two ink blobs built from dot screens, deliberately *mis-registered*
 * (offset from each other) the way a real two-pass riso print drifts. The two
 * inks overprint via a blend mode so their overlap reads as a third color.
 *
 * Recomposes per step like aurora/grid. Inks read `--slate-deco-1` / `--slate-deco-2`;
 * the overprint blend reads `--slate-deco-blend` (multiply in light, screen in
 * dark) — all defined per theme + mode in src/styles/tokens.css.
 */

'use client';

import type { CSSProperties } from 'react';

const C1 = 'var(--slate-deco-1)';
const C2 = 'var(--slate-deco-2)';
const BLEND = 'var(--slate-deco-blend)';

/** Per-step ink placement: [ink1: cx,cy,r], [ink2: cx,cy,r]. */
const SCENES: ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]> = [
  [[330, 320, 360], [430, 410, 360]],
  [[760, 280, 340], [660, 360, 340]],
  [[300, 760, 380], [410, 690, 380]],
  [[780, 760, 360], [690, 690, 360]],
  [[540, 300, 380], [620, 380, 380]],
  [[260, 480, 340], [360, 420, 340]],
  [[820, 540, 360], [720, 600, 360]],
  [[540, 800, 380], [460, 730, 380]],
];

export function RisoDecoration({ step }: { step: number }) {
  const i = ((step % SCENES.length) + SCENES.length) % SCENES.length;
  const [a, b] = SCENES[i]!;
  return (
    <svg
      className="slate-decoration"
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-riso-decoration"
    >
      <defs>
        <pattern id="slate-riso-dots-1" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="9" cy="9" r="5.5" fill={C1} />
        </pattern>
        <pattern id="slate-riso-dots-2" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="9" cy="9" r="5.5" fill={C2} />
        </pattern>
        <clipPath id="slate-riso-clip-1">
          <circle cx={a[0]} cy={a[1]} r={a[2]} />
        </clipPath>
        <clipPath id="slate-riso-clip-2">
          <circle cx={b[0]} cy={b[1]} r={b[2]} />
        </clipPath>
      </defs>
      <g style={{ mixBlendMode: BLEND as CSSProperties['mixBlendMode'] }}>
        <rect width="1080" height="1080" fill="url(#slate-riso-dots-1)" clipPath="url(#slate-riso-clip-1)" />
      </g>
      <g style={{ mixBlendMode: BLEND as CSSProperties['mixBlendMode'] }}>
        <rect width="1080" height="1080" fill="url(#slate-riso-dots-2)" clipPath="url(#slate-riso-clip-2)" />
      </g>
    </svg>
  );
}
