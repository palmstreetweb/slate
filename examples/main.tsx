import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useRoute } from './_admin/_router.js';
import { seedIfEmpty } from './_admin/_formsStore.js';
import { seedForms } from './_admin/_seedForms.js';
import { ConfirmProvider } from './_admin/_confirm.js';
import { Dashboard } from './_admin/pages/Dashboard.js';
import { FormEditor } from './_admin/pages/FormEditor.js';
import { FormPreview } from './_admin/pages/FormPreview.js';
import { FormSubmissions } from './_admin/pages/FormSubmissions.js';
import { AdminShell } from './_admin/shell/AdminShell.js';

import './_admin/_adminTheme.css';

// Seed once if the store is empty.
seedIfEmpty(seedForms);

function App() {
  const route = useRoute();

  switch (route.name) {
    case 'dashboard':
      return <Dashboard />;
    case 'editor':
      return <FormEditor formId={route.formId} />;
    case 'preview':
      return <FormPreview formId={route.formId} />;
    case 'submissions':
      return <FormSubmissions formId={route.formId} />;
    case 'notfound':
      return (
        <AdminShell crumbs={null}>
          <div className="studio-empty">
            <p style={{ margin: '0 0 12px' }}>Page not found: {route.path}</p>
            <a href="#/" className="studio-btn studio-btn--primary" style={{ textDecoration: 'none' }}>
              Back to dashboard
            </a>
          </div>
        </AdminShell>
      );
  }
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
