/**
 * "No responses yet" radar (ADR-060): a dot with two rings that ping outward
 * three times, like it is listening for the first answer, then rests as a
 * still radar mark. Decorative only (aria-hidden); rings animate transform
 * and opacity, and calm motion shows the resting mark.
 */

'use client';

export function RadarPing() {
  return (
    <span className="slate-radar" aria-hidden="true">
      <i className="slate-radar-ring" />
      <i className="slate-radar-ring" />
      <b className="slate-radar-dot" />
    </span>
  );
}
