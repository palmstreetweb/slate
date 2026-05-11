import { useEffect, useState } from 'react';
import { Form } from '@/index.js';
import { getForm, subscribe, type FormRecord } from '../_formsStore.js';
import { addSubmission } from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { AdminShell } from '../shell/AdminShell.js';

type Props = { formId: string };

export function FormPreview({ formId }: Props) {
  const [form, setForm] = useState<FormRecord | null>(() => getForm(formId));

  // Re-fetch when the formId changes or another tab edits the schema.
  useEffect(() => {
    setForm(getForm(formId));
    return subscribe(() => setForm(getForm(formId)));
  }, [formId]);

  if (!form) {
    return (
      <AdminShell crumbs={null}>
        <div className="studio-empty">
          <p style={{ margin: '0 0 12px' }}>Form not found.</p>
          <button type="button" className="studio-btn studio-btn--primary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      crumbs={
        <span className="studio-crumb">
          <button type="button" className="studio-link" onClick={() => navigate('/')}>
            Forms
          </button>
          {' / '}
          <button type="button" className="studio-link" onClick={() => navigate(`/forms/${formId}/edit`)}>
            {form.name}
          </button>
          {' / '}
          <span style={{ color: 'var(--psw-text)' }}>Preview</span>
        </span>
      }
      rightSlot={
        <>
          <button type="button" className="studio-btn" onClick={() => navigate(`/forms/${formId}/edit`)}>
            ← Back to editor
          </button>
          <button type="button" className="studio-btn" onClick={() => navigate(`/forms/${formId}/submissions`)}>
            Responses
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--psw-muted)' }}>
        Live preview. Submissions you make here are saved to localStorage and visible under{' '}
        <button type="button" className="studio-link" onClick={() => navigate(`/forms/${formId}/submissions`)}>
          Responses
        </button>.
      </p>
      <div className="studio-preview" style={{ height: 'calc(100vh - 160px)', overflow: 'hidden' }}>
        <Form
          schema={form.schema}
          onSubmit={async (answers, meta) => {
            await new Promise((r) => setTimeout(r, 250));
            addSubmission(formId, answers, meta);
          }}
        />
      </div>
    </AdminShell>
  );
}
