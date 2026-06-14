/**
 * Memphis decoration — playful 1980s "Memphis Group" furniture: squiggles,
 * zigzags, concentric arcs, triangles, and dot grids scattered around the
 * edges. Recomposes per step like aurora/grid/shapes.
 *
 * Shape fills read `--slate-deco-1/2/3`; strokes read `--slate-deco-line`. All are
 * defined per theme + mode in src/styles/tokens.css.
 */

'use client';

import type { ReactElement } from 'react';

const C1 = 'var(--slate-deco-1)';
const C2 = 'var(--slate-deco-2)';
const C3 = 'var(--slate-deco-3)';
const LINE = 'var(--slate-deco-line)';

function Squiggle({ x, y, c = LINE }: { x: number; y: number; c?: string }): ReactElement {
  return (
    <path
      d={`M ${x} ${y} q 20 -28 40 0 t 40 0 t 40 0 t 40 0`}
      fill="none"
      stroke={c}
      strokeWidth="7"
      strokeLinecap="round"
    />
  );
}

function Zigzag({ x, y, c = C2 }: { x: number; y: number; c?: string }): ReactElement {
  return (
    <path
      d={`M ${x} ${y} l 26 -30 l 26 30 l 26 -30 l 26 30`}
      fill="none"
      stroke={c}
      strokeWidth="7"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

function Arcs({ x, y, c = C1 }: { x: number; y: number; c?: string }): ReactElement {
  return (
    <g fill="none" stroke={c} strokeWidth="7">
      <path d={`M ${x - 50} ${y} a 50 50 0 0 1 100 0`} />
      <path d={`M ${x - 30} ${y} a 30 30 0 0 1 60 0`} />
      <path d={`M ${x - 12} ${y} a 12 12 0 0 1 24 0`} />
    </g>
  );
}

function Triangle({ x, y, c = C3 }: { x: number; y: number; c?: string }): ReactElement {
  return <path d={`M ${x} ${y - 42} L ${x + 38} ${y + 28} L ${x - 38} ${y + 28} Z`} fill={c} opacity="0.9" />;
}

function Dots({ x, y, c = C1 }: { x: number; y: number; c?: string }): ReactElement {
  const dots = [];
  for (let r = 0; r < 3; r++) {
    for (let col = 0; col < 3; col++) {
      dots.push(<circle key={`${r}-${col}`} cx={x + col * 24} cy={y + r * 24} r={5} fill={c} />);
    }
  }
  return <g opacity="0.9">{dots}</g>;
}

function Circle({ x, y, c = C2 }: { x: number; y: number; c?: string }): ReactElement {
  return <circle cx={x} cy={y} r={34} fill={c} opacity="0.9" />;
}

/** Each scene scatters a handful of motifs around the frame edges. */
const SCENES: ReadonlyArray<() => ReactElement> = [
  () => (
    <>
      <Squiggle x={120} y={180} />
      <Triangle x={900} y={220} />
      <Dots x={840} y={820} />
      <Arcs x={200} y={900} />
    </>
  ),
  () => (
    <>
      <Zigzag x={760} y={200} />
      <Circle x={180} y={260} />
      <Arcs x={880} y={840} c={C3} />
      <Squiggle x={150} y={860} c={C2} />
    </>
  ),
  () => (
    <>
      <Dots x={140} y={160} c={C2} />
      <Triangle x={860} y={840} c={C1} />
      <Squiggle x={720} y={200} />
      <Circle x={230} y={880} c={C3} />
    </>
  ),
  () => (
    <>
      <Arcs x={200} y={240} />
      <Zigzag x={780} y={840} c={C1} />
      <Circle x={880} y={220} />
      <Dots x={140} y={820} c={C3} />
    </>
  ),
  () => (
    <>
      <Triangle x={170} y={220} c={C2} />
      <Squiggle x={700} y={860} />
      <Dots x={860} y={180} />
      <Arcs x={250} y={880} c={C2} />
    </>
  ),
  () => (
    <>
      <Circle x={180} y={200} c={C1} />
      <Zigzag x={740} y={220} c={C3} />
      <Triangle x={880} y={860} />
      <Squiggle x={130} y={880} />
    </>
  ),
  () => (
    <>
      <Squiggle x={720} y={180} c={C2} />
      <Arcs x={210} y={260} c={C3} />
      <Dots x={840} y={820} c={C2} />
      <Circle x={220} y={870} />
    </>
  ),
  () => (
    <>
      <Dots x={150} y={200} />
      <Triangle x={880} y={230} c={C2} />
      <Zigzag x={180} y={860} c={C1} />
      <Arcs x={860} y={860} />
    </>
  ),
];

export function MemphisDecoration({ step }: { step: number }) {
  const Scene = SCENES[((step % SCENES.length) + SCENES.length) % SCENES.length]!;
  return (
    <svg
      className="slate-decoration"
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-memphis-decoration"
    >
      <Scene />
    </svg>
  );
}
