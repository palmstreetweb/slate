import { useEffect, useState } from 'react';
import { Form } from '@/index.js';
import { getForm, subscribe, type FormRecord } from '../_formsStore.js';
import { addSubmission } from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { AdminShell } from '../shell/AdminShell.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { getLocalUploadMeta } from '../localFileStore.js';

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
        <div className="slate-empty">
          <p style={{ margin: '0 0 12px' }}>Form not found.</p>
          <button type="button" className="slate-btn slate-btn--primary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      crumbs={
        <span className="slate-crumb">
          <button type="button" className="slate-link" onClick={() => navigate('/')}>
            Forms
          </button>
          {' / '}
          <button type="button" className="slate-link" onClick={() => navigate(`/forms/${formId}/edit`)}>
            {form.name}
          </button>
          {' / '}
          <span style={{ color: 'var(--slate-text)' }}>Preview</span>
        </span>
      }
      rightSlot={
        <>
          <button type="button" className="slate-btn" onClick={() => navigate(`/forms/${formId}/edit`)}>
            ← Back to editor
          </button>
          <button type="button" className="slate-btn" onClick={() => navigate(`/forms/${formId}/submissions`)}>
            Responses
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--slate-muted)' }}>
        Live preview. Submissions you make here are saved to localStorage and visible under{' '}
        <button type="button" className="slate-link" onClick={() => navigate(`/forms/${formId}/submissions`)}>
          Responses
        </button>.
      </p>
      <div className="slate-preview" style={{ height: 'calc(100vh - 160px)', overflow: 'hidden' }}>
        {/* No `resume` here: the preview is a build/test surface, not a real
            respondent session. Autosaving partial test runs and offering to
            resume them on every preview open reads as a glitch. Production
            embeds opt into save-and-resume themselves (ADR-017). */}
        <Form
          schema={form.schema}
          onFileUpload={hostFileUpload}
          resolveFileUploadMeta={getLocalUploadMeta}
          onSubmit={async (answers, meta) => {
            await new Promise((r) => setTimeout(r, 250));
            addSubmission(formId, answers, meta);
          }}
        />
      </div>
    </AdminShell>
  );
}
