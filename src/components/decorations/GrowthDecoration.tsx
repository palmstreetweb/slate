/**
 * Growth decoration — a *narrative* backdrop, like the constellation. A vine
 * climbs one segment per step, sprouting a leaf at each node, and breaks into
 * flower on the final steps. The form's progress is the plant's growth; the
 * thank-you screen is the full bloom.
 *
 * Stem reads `--slate-deco-line`, leaves `--slate-deco-1`, petals `--slate-deco-2`,
 * flower centers `--slate-deco-3` — all defined per theme + mode in tokens.css.
 */

'use client';

import type { ReactElement } from 'react';

const STEM = 'var(--slate-deco-line)';
const LEAF = 'var(--slate-deco-1)';
const PETAL = 'var(--slate-deco-2)';
const CENTER = 'var(--slate-deco-3)';

/** Nodes of the climbing stem, bottom → top. Gentle side-to-side wander. */
const NODES: ReadonlyArray<readonly [number, number]> = [
  [540, 1060],
  [500, 930],
  [565, 805],
  [495, 685],
  [565, 565],
  [490, 450],
  [560, 345],
  [500, 245],
  [560, 155],
  [535, 75],
];

/** Smooth a polyline into a quadratic path through its points' midpoints. */
function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length < 2) return '';
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    d += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`;
  }
  const last = points[points.length - 1]!;
  d += ` T ${last[0]} ${last[1]}`;
  return d;
}

function Leaf({ x, y, side }: { x: number; y: number; side: 1 | -1 }): ReactElement {
  const cx = x + side * 26;
  const cy = y - 6;
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={28}
      ry={12}
      fill={LEAF}
      opacity="0.82"
      transform={`rotate(${side * -26} ${cx} ${cy})`}
    />
  );
}

function Flower({ x, y, scale = 1 }: { x: number; y: number; scale?: number }): ReactElement {
  const petals = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * 15 * scale;
    const py = y + Math.sin(a) * 15 * scale;
    petals.push(
      <ellipse
        key={k}
        cx={px}
        cy={py}
        rx={12 * scale}
        ry={7.5 * scale}
        fill={PETAL}
        opacity="0.88"
        transform={`rotate(${(a * 180) / Math.PI + 90} ${px} ${py})`}
      />,
    );
  }
  return (
    <g>
      {petals}
      <circle cx={x} cy={y} r={7.5 * scale} fill={CENTER} />
    </g>
  );
}

export function GrowthDecoration({ step }: { step: number }) {
  // Start with a small sprout (2 nodes), grow one node per step.
  const grown = Math.max(2, Math.min(step + 2, NODES.length));
  const fullyGrown = grown >= NODES.length;
  const revealed = NODES.slice(0, grown);
  const tip = revealed[revealed.length - 1]!;

  return (
    <svg
      className="slate-decoration"
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-growth-decoration"
    >
      <path d={smoothPath(revealed)} fill="none" stroke={STEM} strokeWidth="6" strokeLinecap="round" />

      {revealed.slice(1).map(([x, y], i) => (
        <Leaf key={`l${i}`} x={x} y={y} side={i % 2 === 0 ? 1 : -1} />
      ))}

      {fullyGrown ? (
        <>
          <Flower x={tip[0]} y={tip[1]} scale={1.15} />
          <Flower x={NODES[6]![0]} y={NODES[6]![1]} scale={0.85} />
          <Flower x={NODES[4]![0]} y={NODES[4]![1]} scale={0.7} />
        </>
      ) : (
        // A closed bud at the growing tip until the plant is fully grown.
        <g>
          <ellipse cx={tip[0]} cy={tip[1] - 8} rx={10} ry={16} fill={PETAL} opacity="0.85" />
          <circle cx={tip[0]} cy={tip[1] - 16} r={5} fill={CENTER} opacity="0.9" />
        </g>
      )}
    </svg>
  );
}
