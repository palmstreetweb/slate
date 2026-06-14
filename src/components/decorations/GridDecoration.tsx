/**
 * Grid decoration — a faint technical line grid with a single accent cell
 * that moves on every step. Suits terminal / blueprint / brutalist themes.
 *
 * The grid lines read `--slate-deco-line`; the accent cell reads `--slate-accent`.
 * Both are defined per theme + mode in src/styles/tokens.css.
 */

'use client';

const LINE = 'var(--slate-deco-line)';
const ACCENT = 'var(--slate-accent)';

const CELL = 120; // grid pitch in viewBox units (1080 / 9)

/** Per-step accent cell positions (col,row in the 9×9 grid). */
const CELLS: ReadonlyArray<readonly [number, number]> = [
  [7, 1],
  [1, 2],
  [5, 6],
  [2, 7],
  [6, 3],
  [0, 5],
  [8, 8],
  [3, 0],
];

export function GridDecoration({ step }: { step: number }) {
  const lines = [];
  for (let i = 1; i < 9; i++) {
    const p = i * CELL;
    lines.push(<line key={`v${i}`} x1={p} y1={0} x2={p} y2={1080} stroke={LINE} strokeWidth="1.5" />);
    lines.push(<line key={`h${i}`} x1={0} y1={p} x2={1080} y2={p} stroke={LINE} strokeWidth="1.5" />);
  }
  const [col, row] = CELLS[((step % CELLS.length) + CELLS.length) % CELLS.length]!;
  return (
    <svg
      className="slate-decoration"
      viewBox="0 0 1080 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      data-testid="slate-grid-decoration"
    >
      {lines}
      <rect
        x={col * CELL}
        y={row * CELL}
        width={CELL}
        height={CELL}
        fill={ACCENT}
        opacity="0.16"
      />
      <rect
        x={col * CELL}
        y={row * CELL}
        width={CELL}
        height={CELL}
        fill="none"
        stroke={ACCENT}
        strokeWidth="2.5"
        opacity="0.5"
      />
    </svg>
  );
}
