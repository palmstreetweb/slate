/**
 * Aurora decoration — soft, blurred gradient blobs that recompose on every
 * step, giving gradient/dark themes a calm shifting backdrop. Same per-step
 * model as SwissDecoration: an array of scenes indexed by step.
 *
 * Fills read the `--slate-deco-1/2/3` tokens (defined per theme + mode in
 * src/styles/tokens.css) so light/dark each get an appropriate palette.
 */

'use client';

import type { ReactElement } from 'react';

const A = 'var(--slate-deco-1)';
const B = 'var(--slate-deco-2)';
const C = 'var(--slate-deco-3)';

/** Each scene is a set of large, soft circles blurred into glows. */
const SCENES: ReadonlyArray<() => ReactElement> = [
  // 0 — welcome: calm, two distant glows
  () => (
    <>
      <circle cx="850" cy="220" r="360" fill={A} opacity="0.55" />
      <circle cx="180" cy="920" r="300" fill={B} opacity="0.45" />
    </>
  ),
  // 1
  () => (
    <>
      <circle cx="180" cy="200" r="320" fill={B} opacity="0.5" />
      <circle cx="950" cy="780" r="380" fill={C} opacity="0.45" />
    </>
  ),
  // 2
  () => (
    <>
      <circle cx="540" cy="-40" r="340" fill={A} opacity="0.5" />
      <circle cx="120" cy="640" r="260" fill={C} opacity="0.4" />
      <circle cx="980" cy="980" r="240" fill={B} opacity="0.4" />
    </>
  ),
  // 3
  () => (
    <>
      <circle cx="1000" cy="120" r="300" fill={B} opacity="0.5" />
      <circle cx="60" cy="540" r="360" fill={A} opacity="0.5" />
    </>
  ),
  // 4
  () => (
    <>
      <circle cx="300" cy="300" r="280" fill={C} opacity="0.45" />
      <circle cx="860" cy="620" r="360" fill={A} opacity="0.5" />
    </>
  ),
  // 5
  () => (
    <>
      <circle cx="540" cy="980" r="380" fill={B} opacity="0.5" />
      <circle cx="940" cy="180" r="260" fill={C} opacity="0.4" />
    </>
  ),
  // 6
  () => (
    <>
      <circle cx="120" cy="120" r="300" fill={A} opacity="0.5" />
      <circle cx="980" cy="980" r="340" fill={B} opacity="0.45" />
      <circle cx="560" cy="520" r="200" fill={C} opacity="0.35" />
    </>
  ),
  // 7 — thanks: a single warm hero glow
  () => (
    <>
      <circle cx="540" cy="360" r="420" fill={A} opacity="0.55" />
      <circle cx="540" cy="980" r="280" fill={C} opacity="0.4" />
    </>
  ),
];

type Props = {
  /** Index of the current step in the visible-questions list. */
  step: number;
};

export function AuroraDecoration({ step }: Props) {
  const Scene = SCENES[((step % SCENES.length) + SCENES.length) % SCENES.length]!;
  return (
    <svg
      className="slate-decoration"
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-aurora-decoration"
    >
      <defs>
        <filter id="slate-aurora-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="80" />
        </filter>
      </defs>
      <g filter="url(#slate-aurora-blur)">
        <Scene />
      </g>
    </svg>
  );
}
