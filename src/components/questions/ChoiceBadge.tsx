/**
 * Letter badge for choice options. On commit (ADR-059) the letter flips to a
 * check that draws itself; motion.css owns the timing. Uncommitted badges
 * render the bare letter, exactly as before.
 */

'use client';

type Props = {
  letter: string;
  committed?: boolean;
};

export function ChoiceBadge({ letter, committed = false }: Props) {
  return (
    <span className="slate-choice-badge">
      {committed ? (
        <>
          <span className="slate-badge-key">{letter}</span>
          <svg className="slate-badge-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </>
      ) : (
        letter
      )}
    </span>
  );
}
