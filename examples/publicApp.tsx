/**
 * Respondent bundle (ADR-048): `/forms/{slug}` and `/r?d=…` only. No studio
 * pages, no auth provider, no Neon SDK — a QR scan on bad Wi-Fi downloads
 * the form engine and this, nothing else.
 */

import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { routeKey, useRoute } from './_admin/_router.js';
import { ErrorBoundary } from './_admin/components/ErrorBoundary.js';
import { PublicFill } from './_admin/pages/PublicFill.js';
import { PageTransition } from './_admin/shell/PageTransition.js';
import { LoadingScreen } from './_admin/shell/LoadingScreen.js';
import { initSentry, sentryRootOptions } from './sentry.js';

import './_admin/slateChromeTokens.css';
import './_admin/publicChrome.css';
import './_admin/slateMotion.css';

// Portable links are rare and keep answers on the device; load that path on demand.
const PublicRespond = lazy(() =>
  import('./_admin/pages/PublicRespond.js').then((m) => ({ default: m.PublicRespond })),
);

function PublicRoutes() {
  const route = useRoute();
  const key = routeKey(route);
  const respondentRoute = route.name === 'fill' || route.name === 'respond';

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
  initSentry();
  createRoot(root, sentryRootOptions()).render(
    <StrictMode>
      <ErrorBoundary label="form" fallback={<FillCrashFallback />}>
        <PublicRoutes />
      </ErrorBoundary>
    </StrictMode>,
  );
}
