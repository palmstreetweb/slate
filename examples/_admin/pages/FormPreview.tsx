import { useEffect, useMemo, useState } from 'react';
import { Form } from '@/index.js';
import { signupPicks } from '@/logic/signup.js';
import { getForm, subscribe, type FormRecord } from '../_formsStore.js';
import {
  addSubmission,
  ensureFormSubmissions,
  listSubmissions,
  subscribe as subscribeSubmissions,
} from '../_submissionStore.js';
import { localSlotsLeft, slotFullMessage } from '../signupSlots.js';
import { navigate } from '../_router.js';
import { AdminShell } from '../shell/AdminShell.js';
import { IconChart } from '../mobile/PhoneChrome.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { setUploadContext, clearUploadContext } from '../uploadContext.js';

type Props = { formId: string };

export function FormPreview({ formId }: Props) {
  const [form, setForm] = useState<FormRecord | null>(() => getForm(formId));
  // Sign-up slots (ADR-066): a test run counts spots from the responses this browser holds,
  // and refuses a full slot the way the submit Function does, so the whole flow can be tried.
  const [subsTick, setSubsTick] = useState(0);
  useEffect(() => {
    void ensureFormSubmissions(formId);
    return subscribeSubmissions(() => setSubsTick((n) => n + 1));
  }, [formId]);
  const slotsLeft = useMemo(
    () => (form ? localSlotsLeft(form.schema.questions, listSubmissions(formId)) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recount when responses change
    [form, formId, subsTick],
  );

  // Re-fetch when the formId changes or another tab edits the schema.
  useEffect(() => {
    setForm(getForm(formId));
    setUploadContext(formId);
    const unsub = subscribe(() => setForm(getForm(formId)));
    return () => {
      unsub();
      clearUploadContext();
    };
  }, [formId]);

  if (!form) {
    return (
      <AdminShell crumbs={null}>
        <div className="slate-empty">
          <p style={{ margin: '0 0 12px' }}>Form not found.</p>
          <button
            type="button"
            className="slate-btn slate-btn--primary"
            onClick={() => navigate('/')}
          >
            Back to dashboard
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      phone={{
        back: { label: 'editor', onClick: () => navigate(`/forms/${formId}/edit`) },
        title: 'Test run',
        subtitle: form.name,
        menu: [
          {
            id: 'responses',
            label: 'Responses',
            icon: <IconChart />,
            onSelect: () => navigate(`/forms/${formId}/submissions`),
          },
        ],
      }}
      crumbs={
        <span className="slate-crumb">
          <button type="button" className="slate-link" onClick={() => navigate('/')}>
            Forms
          </button>
          {' / '}
          <button
            type="button"
            className="slate-link"
            onClick={() => navigate(`/forms/${formId}/edit`)}
          >
            {form.name}
          </button>
          {' / '}
          <span style={{ color: 'var(--slate-text)' }}>Preview</span>
        </span>
      }
      rightSlot={
        <>
          <button
            type="button"
            className="slate-btn"
            onClick={() => navigate(`/forms/${formId}/edit`)}
          >
            ← Back to editor
          </button>
          <button
            type="button"
            className="slate-btn"
            onClick={() => navigate(`/forms/${formId}/submissions`)}
          >
            Responses
          </button>
        </>
      }
    >
      <p className="slate-preview-note">
        Live preview. Submissions you make here are saved and visible under{' '}
        <button
          type="button"
          className="slate-link"
          onClick={() => navigate(`/forms/${formId}/submissions`)}
        >
          Responses
        </button>
        .
      </p>
      <div className="slate-preview slate-preview--page">
        {/* No `resume` here: the preview is a build/test surface, not a real
            respondent session. Autosaving partial test runs and offering to
            resume them on every preview open reads as a glitch. Production
            embeds opt into save-and-resume themselves (ADR-017). */}
        <Form
          schema={form.schema}
          onFileUpload={hostFileUpload}
          resolveFileUploadMeta={resolveUploadMeta}
          slotsLeft={slotsLeft}
          onSubmit={async (answers, meta) => {
            const left = localSlotsLeft(form.schema.questions, listSubmissions(formId));
            const full = Object.entries(left).flatMap(([question, per]) =>
              signupPicks(answers[question])
                .slots.filter((slot) => per[slot] === 0)
                .map((slot) => ({ question, slot })),
            );
            if (full.length) {
              throw Object.assign(new Error(slotFullMessage(form.schema.questions, full)), {
                goTo: full[0]!.question,
              });
            }
            addSubmission(formId, answers, meta);
          }}
        />
      </div>
    </AdminShell>
  );
}
