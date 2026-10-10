/**
 * Respondent bundle (ADR-048): `/forms/{slug}`, `/r?d=…` and paths nothing
 * serves ("We couldn’t find that page", F27) only. No studio
 * pages, no auth provider, no Neon SDK — a QR scan on bad Wi-Fi downloads
 * the form engine and this, nothing else.
 */

import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { isRespondentRoute, routeKey, useRoute } from './_admin/_router.js';
import { ErrorBoundary } from './_admin/components/ErrorBoundary.js';
import { PublicFill } from './_admin/pages/PublicFill.js';
import { PageNotFound } from './_admin/pages/PageNotFound.js';
import { PageTransition } from './_admin/shell/PageTransition.js';
import { LoadingScreen } from './_admin/shell/LoadingScreen.js';
import { PAGE_DIDNT_LOAD } from './_admin/fillCopy.js';
import { readSlateMode } from './_admin/slateMode.js';
import { initSentry, sentryRootOptions } from './sentry.js';

import './_admin/slateChromeTokens.css';
import './_admin/publicChrome.css';
import './_admin/slateMotion.css';

/**
 * The portable page's code didn't download (nothing typed yet): a plain line
 * and a "Try again" that reloads. The entry no longer reloads respondent pages
 * by itself (X2), so without this a failed download would be a blank page.
 */
function RespondDidntLoad() {
  return (
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-theme={readSlateMode()}
      className="slate-app"
    >
      <main className="slate-fill-gate">
        <div className="slate-fill-gate-card">
          <p className="slate-fill-gate-notice" role="status" style={{ justifySelf: 'center' }}>
            {PAGE_DIDNT_LOAD}
          </p>
          <button
            type="button"
            className="slate-btn slate-btn--primary slate-fill-gate-submit"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </main>
    </div>
  );
}

// Portable links are rare and keep answers on the device; load that path on demand.
const PublicRespond = lazy(() =>
  import('./_admin/pages/PublicRespond.js').then(
    (m) => ({ default: m.PublicRespond }),
    () => ({ default: RespondDidntLoad }),
  ),
);

function PublicRoutes() {
  const route = useRoute();
  const key = routeKey(route);
  const respondentRoute = isRespondentRoute(route);

  useEffect(() => {
    // Anything else needs the studio bundle — reload so the entry picks it.
    if (!respondentRoute) window.location.reload();
  }, [respondentRoute]);

  if (route.name === 'fill') {
    return (
      <PageTransition routeKey={key}>
        <PublicFill slug={route.slug} />
      </PageTransition>
    );
  }
  if (route.name === 'respond') {
    return (
      <PageTransition routeKey={key}>
        <Suspense fallback={<LoadingScreen label="Loading form" />}>
          <PublicRespond token={route.token} />
        </Suspense>
      </PageTransition>
    );
  }
  if (route.name === 'notfound') return <PageNotFound />;
  return null;
}

function FillCrashFallback() {
  return (
    <div
      role="alert"
      style={{
        maxWidth: 420,
        margin: '20vh auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>This form hit a problem.</p>
      <p style={{ margin: '0 0 16px', opacity: 0.75 }}>Refresh the page to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Refresh
      </button>
    </div>
  );
}

export function mountPublic(root: HTMLElement): void {
  // Errors only on a respondent's page: no browser tracing, no trace sampling (ADR-071).
  initSentry({ tracing: false });
  createRoot(root, sentryRootOptions()).render(
    <StrictMode>
      <ErrorBoundary label="form" fallback={<FillCrashFallback />}>
        <PublicRoutes />
      </ErrorBoundary>
    </StrictMode>,
  );
}
