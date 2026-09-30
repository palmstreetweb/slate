/**
 * Drawn faces and stars for styled scales (ADR-063). SVG in theme ink —
 * strokes and fills come from CSS (`extensions.css`), so every theme and both
 * modes draw them in their own colours. Emoji characters were rejected: they
 * look different on every phone and ignore the theme.
 */

'use client';

/** Mood 0 (lowest) … 1 (highest) → a face whose mouth, eyes and brows follow it. */
export function Face({ t, className }: { t: number; className?: string }) {
  const mood = Math.max(-1, Math.min(1, (Number.isFinite(t) ? t : 0.5) * 2 - 1));
  const half = 16 + Math.abs(mood) * 4;
  const y = 66 - mood * 2;
  const bend = mood * 13;
  const mouth = `M${50 - half} ${y} Q50 ${y + bend} ${50 + half} ${y}`;
  // Worried brows (inner ends up) at the low end; happy eyes close into arcs at the top.
  const brow = mood < -0.6 ? (-mood - 0.6) * 14 : 0;
  const beaming = mood > 0.75;
  return (
    <svg
      viewBox="0 0 100 100"
      className={className ? `slate-face ${className}` : 'slate-face'}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="slate-face-head" cx="50" cy="50" r="43" />
      {beaming ? (
        <>
          <path className="slate-face-line" d="M29 44 Q36 35 43 44" />
          <path className="slate-face-line" d="M57 44 Q64 35 71 44" />
        </>
      ) : (
        <>
          <circle className="slate-face-eye" cx="36" cy="42" r="4.6" />
          <circle className="slate-face-eye" cx="64" cy="42" r="4.6" />
        </>
      )}
      {brow > 0 ? (
        <>
          <path className="slate-face-line" d={`M28 ${31 + brow * 0.3} L42 ${31 - brow}`} />
          <path className="slate-face-line" d={`M72 ${31 + brow * 0.3} L58 ${31 - brow}`} />
        </>
      ) : null}
      <path className="slate-face-line slate-face-mouth" d={mouth} />
    </svg>
  );
}

const STAR = 'M12 2.6l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.1l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.8z';

/** One star. `fill` is how much of it is lit: 'on', 'preview' (hover / focus) or 'off'. */
export function Star({ fill }: { fill: 'on' | 'preview' | 'off' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`slate-star slate-star--${fill}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={STAR} />
    </svg>
  );
}
