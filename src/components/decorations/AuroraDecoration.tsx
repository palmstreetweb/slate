/**
 * Aurora decoration — soft, blurred gradient blobs that recompose on every
 * step, giving gradient/dark themes a calm shifting backdrop. Same per-step
 * model as SwissDecoration: an array of scenes indexed by step.
 *
 * Fills read the `--slate-deco-1/2/3` tokens (defined per theme + mode in
 * src/styles/tokens.css) so light/dark each get an appropriate palette.
 *
 * Cross-fade (ADR-059): on a step change the previous scene stays underneath
 * while the new one fades in over it, then the old layer is dropped. Each
 * scene is its own <svg>, so the blur is rasterised once and only the
 * layer's opacity animates (compositor-only). Calm motion swaps instantly.
 */

'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion.js';

const A = 'var(--slate-deco-1)';
const B = 'var(--slate-deco-2)';
const C = 'var(--slate-deco-3)';

/**
 * Each scene is a set of large, soft circles blurred into glows, one per step:
 * 0 is the welcome (calm, two distant glows), 7 the thanks (a single warm hero
 * glow). Comments stay out of the array: inside it they ship in the bundle.
 */
const SCENES: ReadonlyArray<() => ReactElement> = [
  () => (
    <>
      <circle cx="850" cy="220" r="360" fill={A} opacity="0.55" />
      <circle cx="180" cy="920" r="300" fill={B} opacity="0.45" />
    </>
  ),
  () => (
    <>
      <circle cx="180" cy="200" r="320" fill={B} opacity="0.5" />
      <circle cx="950" cy="780" r="380" fill={C} opacity="0.45" />
    </>
  ),
  () => (
    <>
      <circle cx="540" cy="-40" r="340" fill={A} opacity="0.5" />
      <circle cx="120" cy="640" r="260" fill={C} opacity="0.4" />
      <circle cx="980" cy="980" r="240" fill={B} opacity="0.4" />
    </>
  ),
  () => (
    <>
      <circle cx="1000" cy="120" r="300" fill={B} opacity="0.5" />
      <circle cx="60" cy="540" r="360" fill={A} opacity="0.5" />
    </>
  ),
  () => (
    <>
      <circle cx="300" cy="300" r="280" fill={C} opacity="0.45" />
      <circle cx="860" cy="620" r="360" fill={A} opacity="0.5" />
    </>
  ),
  () => (
    <>
      <circle cx="540" cy="980" r="380" fill={B} opacity="0.5" />
      <circle cx="940" cy="180" r="260" fill={C} opacity="0.4" />
    </>
  ),
  () => (
    <>
      <circle cx="120" cy="120" r="300" fill={A} opacity="0.5" />
      <circle cx="980" cy="980" r="340" fill={B} opacity="0.45" />
      <circle cx="560" cy="520" r="200" fill={C} opacity="0.35" />
    </>
  ),
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

/** Matches the `slate-aurora-in` duration in motion.css, plus a little slack. */
const FADE_MS = 900;

function sceneIndex(step: number): number {
  return ((step % SCENES.length) + SCENES.length) % SCENES.length;
}

function AuroraLayer({
  index,
  className,
  testId,
}: {
  index: number;
  className: string;
  testId?: string;
}) {
  const Scene = SCENES[index]!;
  return (
    <svg
      className={className}
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      {...(testId ? { 'data-testid': testId } : {})}
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

export function AuroraDecoration({ step }: Props) {
  const index = sceneIndex(step);
  const reducedMotion = useReducedMotion();
  const [layers, setLayers] = useState<{ current: number; previous: number | null }>({
    current: index,
    previous: null,
  });

  if (layers.current !== index) {
    setLayers({ current: index, previous: reducedMotion ? null : layers.current });
  }

  // Drop the outgoing layer once the new one has faded in.
  useEffect(() => {
    if (layers.previous === null) return undefined;
    const t = window.setTimeout(
      () => setLayers((l) => ({ current: l.current, previous: null })),
      FADE_MS,
    );
    return () => window.clearTimeout(t);
  }, [layers]);

  return (
    <>
      {layers.previous !== null && (
        <AuroraLayer
          key={`a${layers.previous}`}
          index={layers.previous}
          className="slate-decoration"
        />
      )}
      <AuroraLayer
        key={`a${layers.current}`}
        index={layers.current}
        className={`slate-decoration${layers.previous !== null ? ' slate-deco-fade-in' : ''}`}
        testId="slate-aurora-decoration"
      />
    </>
  );
}
