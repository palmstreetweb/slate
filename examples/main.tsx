import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute, routeKey } from './_admin/_router.js';
import { seedIfEmpty } from './_admin/_formsStore.js';
import { seedForms } from './_admin/_seedForms.js';
import { ConfirmProvider } from './_admin/_confirm.js';
import { Dashboard } from './_admin/pages/Dashboard.js';
import { FormEditor } from './_admin/pages/FormEditor.js';
import { FormPreview } from './_admin/pages/FormPreview.js';
import { FormSubmissions } from './_admin/pages/FormSubmissions.js';
import { AdminShell } from './_admin/shell/AdminShell.js';
import { PageTransition } from './_admin/shell/PageTransition.js';
import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';

import './_admin/slateChromeTokens.css';
import '@/styles/toggle.css';
import './_admin/_adminTheme.css';

// One-time localStorage migration for the Slate rebrand (ADR-025).
migrateSlateLocalStorageKeys();

// Seed once if the store is empty.
seedIfEmpty(seedForms);

function App() {
  const route = useRoute();
  const key = routeKey(route);

  let page: ReactNode;
  switch (route.name) {
    case 'dashboard':
      page = <Dashboard />;
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

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
