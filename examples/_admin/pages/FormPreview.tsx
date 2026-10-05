import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { asStoredAnswers } from '../storedAnswers.js';
import { navigate } from '../_router.js';
import { AdminShell } from '../shell/AdminShell.js';
import { IconChart } from '../mobile/PhoneChrome.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { setUploadContext, clearUploadContext } from '../uploadContext.js';
import { withoutRepeatedOptionsIn } from '../uniqueOptions.js';
import { withWebRedirects } from '../redirectUrl.js';

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

  // A form saved before options got their own values shows each value once (CH-05).
  const shownSchema = useMemo(
    () => (form ? withWebRedirects(withoutRepeatedOptionsIn(form.schema)) : null),
    [form],
  );

  // The frame scrolls (a tall question reaches OK); each new question starts at
  // its top, like the public page. The first question is already there.
  const frameRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<string | null>(null);
  const toFrameTop = useCallback((id: string) => {
    if (shownRef.current !== null && shownRef.current !== id && frameRef.current) {
      frameRef.current.scrollTop = 0;
    }
    shownRef.current = id;
  }, []);

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
      {/* The frame holds still and the box inside it scrolls: the form's
          light / dark toggle, pinned to the frame, stays on screen on a tall
          question (R17). */}
      <div className="slate-preview slate-preview--page">
        <div ref={frameRef} className="slate-preview-scroll">
          {/* No `resume` here: the preview is a build/test surface, not a real
            respondent session. Autosaving partial test runs and offering to
            resume them on every preview open reads as a glitch. Production
            embeds opt into save-and-resume themselves (ADR-017). */}
          <Form
            schema={shownSchema ?? form.schema}
            onFileUpload={hostFileUpload}
            resolveFileUploadMeta={resolveUploadMeta}
            slotsLeft={slotsLeft}
            onQuestionChange={toFrameTop}
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
              // As the submit Function stores it: a location keeps only its verdict (ADR-068).
              addSubmission(formId, asStoredAnswers(form.schema.questions, answers), meta);
            }}
          />
        </div>
      </div>
    </AdminShell>
  );
}
