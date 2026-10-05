/**
 * A path nothing serves (F27): an old "/thanks-page" redirect, a form link
 * with something stuck on its end ("/forms/abc/example.com/thanks"), a typo.
 * Whoever opens it is usually a respondent, so it says so in their words —
 * no raw path, no studio sign-in, no dashboard button. Part of the small
 * public bundle (ADR-048); the studio shows the same page.
 */

import { PAGE_NOT_FOUND } from '../fillCopy.js';
import { readSlateMode } from '../slateMode.js';

export function PageNotFound() {
  return (
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-theme={readSlateMode()}
      className="slate-app"
    >
      <main className="slate-fill-gate">
        <p className="slate-fill-gate-notice" role="status">
          {PAGE_NOT_FOUND}
        </p>
      </main>
    </div>
  );
}
