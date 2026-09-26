/**
 * Constellation decoration — a *narrative* backdrop. Unlike the recomposing
 * decorations (aurora/grid/shapes), this one is cumulative: each step lights
 * the next star on a wandering path and draws the connector to it, so reaching
 * the thank-you screen completes the whole star map. Progress becomes a picture.
 *
 * Stars read `--slate-deco-1`, connectors read `--slate-deco-line`, and the most
 * recently lit ("current") star reads `--slate-accent`. All are defined per
 * theme + mode in src/styles/tokens.css.
 *
 * Draw-on (ADR-059): each newly lit connector draws itself along its length
 * (stroke-dash) and the new star pops in after it. Stars and lines already
 * on the map never re-animate — only freshly mounted ones do. On a confirmed
 * submit (`complete`) the rest of the map lights up in sequence and every
 * star twinkles once. Calm motion shows the finished state with no motion.
 */

'use client';

import { useState, type CSSProperties } from 'react';

const STAR = 'var(--slate-deco-1)';
const LINE = 'var(--slate-deco-line)';
const ACCENT = 'var(--slate-accent)';

/**
 * The "journey" stars, in reveal order. Positions wander across the field so
 * the connectors trace a loose, pleasing constellation rather than a grid.
 */
const PATH: ReadonlyArray<readonly [number, number]> = [
  [170, 880],
  [320, 720],
  [250, 540],
  [440, 470],
  [560, 600],
  [690, 460],
  [620, 300],
  [790, 210],
  [890, 370],
  [940, 560],
  [820, 700],
  [690, 820],
  [520, 870],
  [400, 980],
];

/** Faint, always-present background dust: [cx, cy, r]. Decorative only. */
const DUST: ReadonlyArray<readonly [number, number, number]> = [
  [90, 140, 2],
  [240, 240, 1.4],
  [470, 120, 1.8],
  [630, 90, 1.2],
  [820, 120, 2],
  [980, 220, 1.5],
  [1000, 430, 1.3],
  [120, 420, 1.6],
  [60, 660, 1.4],
  [300, 1000, 1.6],
  [560, 200, 1.2],
  [760, 980, 1.5],
  [950, 880, 1.7],
  [150, 980, 1.3],
  [880, 60, 1.4],
  [430, 700, 1.2],
];

/** Gap between successive draws when several light at once (resume, finale). */
const STAGGER_MS = 110;

type Props = {
  step: number;
  /** A confirmed submit — light the whole map. */
  complete?: boolean;
};

export function ConstellationDecoration({ step, complete = false }: Props) {
  // At least the first star is lit; one more lights per step, capped at the path length.
  const lit = complete
    ? PATH.length
    : Math.max(1, Math.min(step + 1, PATH.length));

  // Index of the first star that is new since the previous render. Only
  // those get a stagger delay; older ones keep delay 0 so a finished draw
  // is never pulled back into its active interval.
  const [seen, setSeen] = useState(lit);
  const [firstNew, setFirstNew] = useState(0);
  if (lit !== seen) {
    setFirstNew(Math.min(seen, lit));
    setSeen(lit);
  }
  const delayFor = (i: number) => (i >= firstNew ? (i - firstNew) * STAGGER_MS : 0);
  // A new star lands as its connector finishes drawing.
  const starDelay = (i: number) => (i >= firstNew && i > 0 ? delayFor(i) + 360 : 0);
  // Finale twinkle: a ripple along the path, after any star still landing.
  const twinkleDelay = (i: number) => (i >= firstNew ? starDelay(i) + 420 : i * 70);

  const connectors = [];
  for (let i = 1; i < lit; i++) {
    const [x1, y1] = PATH[i - 1]!;
    const [x2, y2] = PATH[i]!;
    const len = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    connectors.push(
      <line
        key={`c${i}`}
        className="slate-deco-draw"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={LINE}
        strokeWidth="1.5"
        strokeDasharray={len}
        style={
          {
            '--slate-draw-len': len,
            '--slate-draw-delay': `${delayFor(i)}ms`,
          } as CSSProperties
        }
      />,
    );
  }

  return (
    <svg
      className={`slate-decoration${complete ? ' slate-decoration--complete' : ''}`}
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-constellation-decoration"
    >
      {DUST.map(([x, y, r], i) => (
        <circle key={`d${i}`} cx={x} cy={y} r={r} fill={STAR} opacity="0.35" />
      ))}
      {connectors}
      {PATH.slice(0, lit).map(([x, y], i) => {
        const current = !complete && i === lit - 1;
        return (
          <circle
            key={`s${i}`}
            className="slate-deco-star"
            cx={x}
            cy={y}
            r={current ? 7 : 4.5}
            fill={current ? ACCENT : STAR}
            opacity={current ? 0.95 : complete ? 1 : 0.8}
            style={
              {
                '--slate-draw-delay': `${starDelay(i)}ms`,
                '--slate-twinkle-delay': `${twinkleDelay(i)}ms`,
              } as CSSProperties
            }
          />
        );
      })}
      {!complete && (
        // Soft halo on the newest star, remounted per step so it pulses once.
        <circle
          key={`h${lit}`}
          className="slate-deco-halo"
          cx={PATH[lit - 1]![0]}
          cy={PATH[lit - 1]![1]}
          r={18}
          fill={ACCENT}
          opacity="0.16"
        />
      )}
    </svg>
  );
}
