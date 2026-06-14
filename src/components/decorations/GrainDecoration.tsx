/**
 * Editorial theme grain overlay — subtle fractal-noise texture over the
 * whole wrapper, ported from the prototype's `.grain-overlay`. Pure CSS
 * (see `.slate-grain` in src/styles/base.css); this component only renders
 * the hook element.
 */

'use client';

export function GrainDecoration() {
  return <div className="slate-grain" aria-hidden="true" data-testid="slate-grain-decoration" />;
}
