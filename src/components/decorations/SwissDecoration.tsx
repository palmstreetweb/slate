/**
 * Swiss theme geometric poster decorations — a different composition per
 * step, cycling through nine layouts. Ported 1:1 from the prototype
 * (intake-form.jsx SWISS_COMPOSITIONS); fills read the `--slate-deco-*`
 * tokens defined in src/styles/tokens.css so light/dark each get a
 * mode-appropriate palette.
 */

'use client';

import type { ReactElement } from 'react';

const RED = 'var(--slate-deco-red)';
const YELLOW = 'var(--slate-deco-yellow)';
const BLUE = 'var(--slate-deco-blue)';
const INK = 'var(--slate-deco-ink)';

const COMPOSITIONS: ReadonlyArray<() => ReactElement> = [
  // 0 — welcome
  () => (
    <>
      <circle cx="1050" cy="-50" r="420" fill={RED} />
      <rect x="-30" y="780" width="200" height="200" fill={YELLOW} />
    </>
  ),
  // 1
  () => (
    <>
      <rect x="-50" y="600" width="500" height="500" fill={YELLOW} />
      <rect x="850" y="-20" width="220" height="220" fill={INK} />
    </>
  ),
  // 2
  () => (
    <>
      <rect x="-50" y="50" width="800" height="40" fill={INK} transform="rotate(-12 200 100)" />
      <rect x="-50" y="180" width="800" height="40" fill={RED} transform="rotate(-12 200 230)" />
      <circle cx="900" cy="850" r="120" fill={YELLOW} />
    </>
  ),
  // 3
  () => (
    <>
      <circle cx="0" cy="1050" r="500" fill={BLUE} />
      <rect x="700" y="0" width="400" height="120" fill={YELLOW} />
    </>
  ),
  // 4
  () => (
    <>
      <circle cx="-100" cy="500" r="450" fill="none" stroke={RED} strokeWidth="50" />
      <circle cx="-100" cy="500" r="320" fill="none" stroke={RED} strokeWidth="50" />
      <circle cx="-100" cy="500" r="180" fill={RED} />
      <rect x="900" y="700" width="180" height="180" fill={INK} />
    </>
  ),
  // 5
  () => (
    <>
      <polygon points="1080,1080 1080,400 400,1080" fill={YELLOW} />
      <circle cx="120" cy="120" r="80" fill={RED} />
    </>
  ),
  // 6
  () => (
    <>
      <rect x="-50" y="850" width="1180" height="100" fill={RED} />
      <rect x="50" y="50" width="180" height="180" fill={INK} />
      <circle cx="950" cy="200" r="100" fill={YELLOW} />
    </>
  ),
  // 7
  () => (
    <>
      <circle cx="120" cy="900" r="160" fill={BLUE} />
      <rect x="850" y="80" width="200" height="200" fill={RED} />
      <polygon points="500,1000 700,1080 500,1080" fill={INK} />
    </>
  ),
  // 8 — thanks
  () => (
    <>
      <circle cx="950" cy="150" r="200" fill={RED} />
      <rect x="-50" y="400" width="700" height="60" fill={INK} transform="rotate(45 300 430)" />
      <rect x="100" y="300" width="350" height="60" fill={INK} transform="rotate(45 275 330)" />
    </>
  ),
];

type Props = {
  /** Index of the current step in the visible-questions list. */
  step: number;
};

export function SwissDecoration({ step }: Props) {
  const Comp = COMPOSITIONS[((step % COMPOSITIONS.length) + COMPOSITIONS.length) % COMPOSITIONS.length]!;
  return (
    <svg
      className="slate-decoration"
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-swiss-decoration"
    >
      <Comp />
    </svg>
  );
}
