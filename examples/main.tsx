import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { syncHashFromPathname, useRoute, routeKey, type Route } from './_admin/_router.js';
import { seedIfEmpty } from './_admin/_formsStore.js';
import { seedForms } from './_admin/_seedForms.js';
import { ConfirmProvider } from './_admin/_confirm.js';
import { PromptFormTitleProvider } from './_admin/promptFormTitle.js';
import { Dashboard } from './_admin/pages/Dashboard.js';
import { FormEditor } from './_admin/pages/FormEditor.js';
import { FormPreview } from './_admin/pages/FormPreview.js';
import { FormSubmissions } from './_admin/pages/FormSubmissions.js';
import { PublicRespond } from './_admin/pages/PublicRespond.js';
import { PublicFill } from './_admin/pages/PublicFill.js';
import { Login } from './_admin/pages/Login.js';
import { Settings } from './_admin/pages/Settings.js';
import { AdminShell } from './_admin/shell/AdminShell.js';
import { PageTransition } from './_admin/shell/PageTransition.js';
import { AuthProvider, useRequiresAuth } from './_admin/supabase/AuthProvider.js';
import { hydrateStores } from './_admin/supabase/hydrate.js';
import { isSupabaseConfigured } from './_admin/supabase/env.js';
import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';

import './_admin/slateChromeTokens.css';
import '@/styles/toggle.css';
import './_admin/_adminTheme.css';

migrateSlateLocalStorageKeys();
syncHashFromPathname();

function isPublicRoute(route: Route): boolean {
  return route.name === 'respond' || route.name === 'fill';
}

function LoadingScreen() {
  return (
    <div className="slate-empty" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center' }}>
      Loading…
    </div>
  );
}

function AppRoutes() {
  const route = useRoute();
  const { ready, allowed } = useRequiresAuth();
  const key = routeKey(route);

  if (isPublicRoute(route)) {
    let page: ReactNode;
    switch (route.name) {
      case 'respond':
        page = <PublicRespond token={route.token} />;
        break;
      case 'fill':
        page = <PublicFill slug={route.slug} />;
        break;
    }
    return <PageTransition routeKey={key}>{page}</PageTransition>;
  }

  if (isSupabaseConfigured() && !ready) {
    return <LoadingScreen />;
  }

  if (isSupabaseConfigured() && !allowed) {
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
            <a href="#/" className="slate-btn slate-btn--primary" style={{ textDecoration: 'none' }}>
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
  const [storesReady, setStoresReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!allowed) {
      setStoresReady(true);
      return;
    }
    setStoresReady(false);
    void hydrateStores({ force: true })
      .then(() => setStoresReady(true))
      .catch(() => setStoresReady(true));
  }, [ready, allowed]);

  if (!ready || (allowed && !storesReady)) {
    return <LoadingScreen />;
  }

  return <AppRoutes />;
}

function Bootstrap() {
  const route = useRoute();

  if (!isSupabaseConfigured()) {
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
    <AuthProvider>
      <ConfirmProvider>
        <PromptFormTitleProvider>
          <Bootstrap />
        </PromptFormTitleProvider>
      </ConfirmProvider>
    </AuthProvider>
  </StrictMode>,
);
