/**
 * Constellation decoration — a *narrative* backdrop. Unlike the recomposing
 * decorations (aurora/grid/shapes), this one is cumulative: each step lights
 * the next star on a wandering path and draws the connector to it, so reaching
 * the thank-you screen completes the whole star map. Progress becomes a picture.
 *
 * Stars read `--slate-deco-1`, connectors read `--slate-deco-line`, and the most
 * recently lit ("current") star reads `--slate-accent`. All are defined per
 * theme + mode in src/styles/tokens.css.
 */

'use client';

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

export function ConstellationDecoration({ step }: { step: number }) {
  // At least the first star is lit; one more lights per step, capped at the path length.
  const lit = Math.max(1, Math.min(step + 1, PATH.length));

  const connectors = [];
  for (let i = 1; i < lit; i++) {
    const [x1, y1] = PATH[i - 1]!;
    const [x2, y2] = PATH[i]!;
    connectors.push(
      <line key={`c${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={LINE} strokeWidth="1.5" />,
    );
  }

  return (
    <svg
      className="slate-decoration"
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
        const current = i === lit - 1;
        return (
          <circle
            key={`s${i}`}
            cx={x}
            cy={y}
            r={current ? 7 : 4.5}
            fill={current ? ACCENT : STAR}
            opacity={current ? 0.95 : 0.8}
          />
        );
      })}
    </svg>
  );
}
