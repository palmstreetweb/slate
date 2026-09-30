/**
 * "This form is closed" (ADR-063): what a respondent sees instead of the form
 * once it passed its closing time or reached its response cap — before they
 * start typing. Same respondent chrome as the password gate (FillGate): the
 * form's own theme isn't sent for a closed form, so nothing leaks.
 */

'use client';

import type { FormClosedInfo } from '../neon/database.types.js';

type Props = {
  formName: string;
  closed: FormClosedInfo;
  /** It closed while this person was filling it in (their answers weren't sent). */
  duringFill?: boolean;
};

export function FormClosedScreen({ formName, closed, duringFill = false }: Props) {
  const line =
    closed.reason === 'full'
      ? 'It has all the responses it can take.'
      : 'It isn’t taking responses anymore.';
  return (
    <main className="slate-fill-gate">
      <section className="slate-fill-gate-card slate-closed-card" role="status" aria-live="polite">
        <span className="slate-closed-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" focusable="false">
            <rect x="7" y="13" width="34" height="24" rx="4" />
            <path d="M18 13l6-6 6 6" />
            <path d="M15 25h18" />
          </svg>
        </span>
        <p className="slate-closed-kicker">{formName}</p>
        <h1 className="slate-fill-gate-title">This form is closed</h1>
        <p className="slate-fill-gate-label">
          {duringFill ? `It closed before your answers were sent. ${line}` : line}
        </p>
        {closed.message ? (
          <p className="slate-closed-message" dir="auto">
            {closed.message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
