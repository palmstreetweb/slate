import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { syncPathFromHash, useRoute, routeKey, type Route } from './_admin/_router.js';
import { applyUiScale, readUiScale } from './_admin/uiScale.js';
import { seedIfEmpty } from './_admin/_formsStore.js';
import { seedForms } from './_admin/_seedForms.js';
import { ConfirmProvider } from './_admin/_confirm.js';
import { PromptFormTitleProvider } from './_admin/promptFormTitle.js';
import { ToastProvider } from './_admin/toast.js';
import { Dashboard } from './_admin/pages/Dashboard.js';
import { FormEditor } from './_admin/pages/FormEditor.js';
import { FormPreview } from './_admin/pages/FormPreview.js';
import { FormSubmissions } from './_admin/pages/FormSubmissions.js';
import { PublicRespond } from './_admin/pages/PublicRespond.js';
import { PublicFill } from './_admin/pages/PublicFill.js';
import { Login } from './_admin/pages/Login.js';
import { Settings } from './_admin/pages/Settings.js';
import { DropLab } from './_admin/pages/DropLab.js';
import { AdminShell } from './_admin/shell/AdminShell.js';
import { LoadingScreen, useMinBootMs } from './_admin/shell/LoadingScreen.js';
import { PageTransition } from './_admin/shell/PageTransition.js';
import { AuthProvider, useRequiresAuth } from './_admin/neon/AuthProvider.js';
import {
  hydrateStores,
  isAdminSessionHydrated,
  clearAdminSessionHydrated,
  isStoresHydrated,
  markAdminSessionHydrated,
} from './_admin/neon/hydrate.js';
import { isFormsHydrated } from './_admin/neon/formsRemote.js';
import { isNeonConfigured } from './_admin/neon/env.js';
import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';
import { installAdminUiSounds } from './_admin/uiSounds.js';

import './_admin/slateChromeTokens.css';
import '@/styles/toggle.css';
import './_admin/_adminTheme.css';
import './_admin/slateMotion.css';

migrateSlateLocalStorageKeys();
syncPathFromHash();

function UiSoundsRoot({ children }: { children: ReactNode }) {
  useEffect(() => installAdminUiSounds(), []);
  return children;
}

function isPublicRoute(route: Route): boolean {
  return route.name === 'respond' || route.name === 'fill' || route.name === 'dropLab';
}

function AppRoutes() {
  const route = useRoute();
  const { ready, allowed } = useRequiresAuth();
  const key = routeKey(route);
  const publicRoute = isPublicRoute(route);

  // Studio size preference applies to studio chrome only, never to respondents.
  useEffect(() => {
    applyUiScale(publicRoute ? null : readUiScale());
  }, [publicRoute]);

  if (isPublicRoute(route)) {
    let page: ReactNode;
    switch (route.name) {
      case 'respond':
        page = <PublicRespond token={route.token} />;
        break;
      case 'fill':
        page = <PublicFill slug={route.slug} />;
        break;
      case 'dropLab':
        page = <DropLab />;
        break;
    }
    return <PageTransition routeKey={key}>{page}</PageTransition>;
  }

  if (isNeonConfigured() && !ready) {
    return <LoadingScreen />;
  }

  if (isNeonConfigured() && !allowed) {
    return <Login />;
  }

  let page: ReactNode;
  switch (route.name) {
    case 'dashboard':
      page = <Dashboard />;
      break;
    case 'settings':
      page = <Settings />;
      break;
    case 'editor':
      page = <FormEditor formId={route.formId} />;
      break;
    case 'preview':
      page = <FormPreview formId={route.formId} />;
      break;
    case 'submissions':
      page = <FormSubmissions formId={route.formId} />;
      break;
    case 'notfound':
      page = (
        <AdminShell crumbs={null}>
          <div className="slate-empty">
            <p style={{ margin: '0 0 12px' }}>Page not found: {route.path}</p>
            <a href="/" className="slate-btn slate-btn--primary" style={{ textDecoration: 'none' }}>
              Back to dashboard
            </a>
          </div>
        </AdminShell>
      );
      break;
  }

  return <PageTransition routeKey={key}>{page}</PageTransition>;
}

/** Fetch remote stores only after the user is authenticated (cloud mode). */
function AdminCloudBootstrap() {
  const { ready, allowed } = useRequiresAuth();
  const [storesReady, setStoresReady] = useState(() => isAdminSessionHydrated());
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const minBootDone = useMinBootMs();

  useEffect(() => {
    if (!ready) return;
    if (!allowed) {
      setStoresReady(true);
      setHydrateError(null);
      return;
    }
    // Skip re-fetch only when this tab already finished a successful hydrate
    // AND the in-memory Neon caches are still warm. Otherwise we'd paint an
    // empty library until a manual refresh.
    if (isAdminSessionHydrated() && isStoresHydrated() && isFormsHydrated() && retryToken === 0) {
      setStoresReady(true);
      setHydrateError(null);
      return;
    }
    let cancelled = false;
    setStoresReady(false);
    setHydrateError(null);

    const runHydrate = async (attempt: number): Promise<void> => {
      try {
        await hydrateStores({ force: true });
        if (cancelled) return;
        markAdminSessionHydrated();
        setHydrateError(null);
        setStoresReady(true);
      } catch (err: unknown) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Could not load your forms from the cloud.';
        const transientAuth =
          /could not resolve your user id|no auth session|session expired/i.test(message);
        // Auto-retry transient JWT settle races before showing the error screen.
        if (transientAuth && attempt < 3) {
          console.warn(`[slate] Hydrate auth settle — retry ${attempt + 1}/3`, err);
          await new Promise((r) => window.setTimeout(r, 600 * attempt));
          if (cancelled) return;
          return runHydrate(attempt + 1);
        }
        console.error('[slate] Hydrate failed — not treating as empty library.', err);
        clearAdminSessionHydrated();
        setHydrateError(message);
        setStoresReady(true);
      }
    };

    void runHydrate(1);
    return () => {
      cancelled = true;
    };
  }, [ready, allowed, retryToken]);

  // Splash holds for the branding beat AND until auth + Neon hydrate finish.
  // Hydrate starts as soon as the session is allowed — leftover splash time is
  // not idle wait; it's covered by in-flight network + cache warm-up.
  if (!ready || (allowed && !storesReady) || !minBootDone) {
    return <LoadingScreen />;
  }

  if (allowed && hydrateError) {
    return (
      <div
        data-slate-forms=""
        data-theme-name="slate"
        data-theme="dark"
        className="slate-empty"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, maxWidth: 420 }}>
          Couldn’t load your forms from the cloud. They are probably still saved — this is a
          connection/auth glitch, not a delete.
        </p>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 13, maxWidth: 420 }}>{hydrateError}</p>
        <button
          type="button"
          className="slate-btn slate-btn--primary"
          onClick={() => setRetryToken((n) => n + 1)}
        >
          Try again
        </button>
      </div>
    );
  }

  return <AppRoutes />;
}

function Bootstrap() {
  const route = useRoute();

  if (!isNeonConfigured()) {
    seedIfEmpty(seedForms);
    return <AppRoutes />;
  }

  if (isPublicRoute(route)) {
    return <AppRoutes />;
  }

  return <AdminCloudBootstrap />;
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <UiSoundsRoot>
      <AuthProvider>
        <ConfirmProvider>
          <ToastProvider>
            <PromptFormTitleProvider>
              <Bootstrap />
            </PromptFormTitleProvider>
          </ToastProvider>
        </ConfirmProvider>
      </AuthProvider>
    </UiSoundsRoot>
  </StrictMode>,
);
