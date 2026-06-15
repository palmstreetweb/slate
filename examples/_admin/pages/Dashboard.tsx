import { useEffect, useRef, useState } from 'react';
import { defineSchema } from '@/index.js';
import {
  createForm,
  deleteForm,
  duplicateForm,
  listForms,
  probeFormsStorage,
  resetFormsStorage,
  subscribe,
  type FormRecord,
} from '../_formsStore.js';
import {
  countSubmissions,
  lastSubmissionAt,
  probeSubmissionsStorage,
  resetSubmissionsStorage,
} from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { SharePanel } from '../components/SharePanel.js';
import {
  FormCardIconBtn,
  IconDelete,
  IconDuplicate,
  IconEdit,
  IconPreview,
  IconResponses,
  IconShare,
} from '../components/FormCardIcons.js';
import { AdminShell } from '../shell/AdminShell.js';
import { dismissWorkflowTip, WORKFLOW_TIP_KEY } from '../_siteSettings.js';
import {
  animateFormGridDuplicate,
  captureFormCardRects,
  shouldAnimateFormGrid,
} from '../formGridFlip.js';

export function Dashboard() {
  const [forms, setForms] = useState<FormRecord[]>(() => listForms());
  const [storageIssue, setStorageIssue] = useState<'forms' | 'submissions' | 'both' | null>(
    () => {
      const formsBad = probeFormsStorage() === 'corrupt';
      const subsBad = probeSubmissionsStorage() === 'corrupt';
      if (formsBad && subsBad) return 'both';
      if (formsBad) return 'forms';
      if (subsBad) return 'submissions';
      return null;
    },
  );
  const confirm = useConfirm();
  const gridRef = useRef<HTMLDivElement>(null);
  const [tipDismissed, setTipDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(WORKFLOW_TIP_KEY) === '1';
  });

  useEffect(() => subscribe(setForms), []);

  const handleDuplicate = (sourceId: string) => {
    const grid = gridRef.current;
    const before = grid && shouldAnimateFormGrid() ? captureFormCardRects(grid) : null;
    const created = duplicateForm(sourceId);
    if (!created) return;
    if (grid && before) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          animateFormGridDuplicate(grid, sourceId, created.id, before);
        });
      });
    }
  };

  const onNew = () => {
    const created = createForm({
      name: 'Untitled form',
      schema: defineSchema({
        // Brand starts matching the form name so the sync logic in
        // FormEditor can detect "user hasn't customized brand" and follow
        // along when they rename the form. See FormEditorBody.handleNameChange.
        brand: { name: 'Untitled form' },
        theme: 'editorial',
        themeMode: 'toggle',
        questions: [
          { id: 'welcome', type: 'welcome', title: 'Welcome.', cta: 'Start' },
          { id: 'q1', type: 'short_text', title: 'First question?', required: true },
          { id: 'done', type: 'thanks', title: "You're all set.", cta: 'Submit another' },
        ],
      }),
    });
    if (created) navigate(`/forms/${created.id}/edit`);
  };

  return (
    <AdminShell
      crumbs={null}
      rightSlot={
        <button type="button" className="slate-btn slate-btn--new" onClick={onNew}>
          <span className="slate-btn-plus">+</span> New form
        </button>
      }
    >
      {storageIssue && (
        <div
          role="alert"
          className="slate-card"
          style={{
            marginBottom: 20,
            padding: 16,
            borderColor: 'var(--slate-error)',
            background: 'color-mix(in srgb, var(--slate-error) 8%, var(--chrome-panel))',
          }}
        >
          <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--slate-error)' }}>
            localStorage data could not be read
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--slate-muted)' }}>
            {storageIssue === 'both'
              ? 'Saved forms and responses appear corrupted. You can reset storage to start fresh.'
              : storageIssue === 'forms'
                ? 'Saved forms appear corrupted. Responses may still be intact.'
                : 'Saved responses appear corrupted. Your forms may still be intact.'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="slate-btn slate-btn--danger"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Reset local storage?',
                  message: 'Deletes all forms and responses saved in this browser. There is no undo.',
                  confirmLabel: 'Reset storage',
                  danger: true,
                });
                if (!ok) return;
                if (storageIssue === 'forms' || storageIssue === 'both') resetFormsStorage();
                if (storageIssue === 'submissions' || storageIssue === 'both') {
                  resetSubmissionsStorage();
                }
                setForms(listForms());
                setStorageIssue(null);
              }}
            >
              Reset storage
            </button>
            <button type="button" className="slate-btn" onClick={() => navigate('/settings')}>
              Open settings
            </button>
          </div>
        </div>
      )}

      {!tipDismissed && (
        <div
          className="slate-card"
          style={{ marginBottom: 20, padding: 16 }}
          role="note"
        >
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>How Slate works on this site</p>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--slate-muted)', lineHeight: 1.5 }}>
            Forms and responses save in this browser only — use the same browser and URL (
            slateforms.vercel.app). To send a form to someone, use Share → Shareable Link. Export
            backup occasionally so nothing is lost.
          </p>
          <button
            type="button"
            className="slate-btn"
            onClick={() => {
              dismissWorkflowTip();
              setTipDismissed(true);
            }}
          >
            Got it
          </button>
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <h1 className="slate-page-title">Your forms</h1>
        <p className="slate-page-sub">
          {forms.length === 0 ? 'No forms yet.' : `${forms.length} ${forms.length === 1 ? 'form' : 'forms'}`}
        </p>
      </div>

      {forms.length === 0 ? (
        <div className="slate-empty">
          <p style={{ margin: '0 0 12px', fontSize: 15 }}>No forms yet.</p>
          <button type="button" className="slate-btn slate-btn--new" onClick={onNew}>
            <span className="slate-btn-plus">+</span> Create your first form
          </button>
        </div>
      ) : (
        <div ref={gridRef} className="slate-form-grid">
          {forms.map((f) => (
            <FormCard
              key={f.id}
              form={f}
              onDuplicate={() => handleDuplicate(f.id)}
              onDelete={async () => {
                const ok = await confirm({
                  title: `Delete "${f.name}"?`,
                  message:
                    'This also deletes its responses in localStorage. There is no undo.',
                  confirmLabel: 'Delete form',
                  danger: true,
                });
                if (ok) deleteForm(f.id);
              }}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function FormCard({
  form,
  onDuplicate,
  onDelete,
}: {
  form: FormRecord;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const subCount = countSubmissions(form.id);
  const lastAt = lastSubmissionAt(form.id);
  const qCount = form.schema.questions.filter(
    (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
  ).length;

  return (
    <div className="slate-card" data-form-card data-form-id={form.id}>
      <button
        type="button"
        className="slate-card-body-btn"
        onClick={() => navigate(`/forms/${form.id}/edit`)}
        aria-label={`Open ${form.name}`}
      >
        <div className="slate-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span className="slate-card-title">{form.name}</span>
            <p className="slate-card-meta">
              {form.schema.brand.name} · {String(form.schema.theme)}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="slate-badge">{qCount} {qCount === 1 ? 'question' : 'questions'}</span>
            <span className={`slate-badge${subCount > 0 ? ' slate-badge--accent' : ''}`}>
              {subCount} {subCount === 1 ? 'response' : 'responses'}
            </span>
            {lastAt && (
              <span className="slate-badge">last {timeAgo(new Date(lastAt))}</span>
            )}
          </div>
        </div>
      </button>

      <div className="slate-card-footer">
        <div className="slate-card-toolbar" role="toolbar" aria-label={`Actions for ${form.name}`}>
          <FormCardIconBtn label="Edit" onClick={() => navigate(`/forms/${form.id}/edit`)}>
            <IconEdit />
          </FormCardIconBtn>
          <FormCardIconBtn label="Share" onClick={() => setShareOpen(true)}>
            <IconShare />
          </FormCardIconBtn>
          <FormCardIconBtn
            label={subCount > 0 ? `Responses (${subCount})` : 'Responses'}
            badge={subCount}
            onClick={() => navigate(`/forms/${form.id}/submissions`)}
          >
            <IconResponses />
          </FormCardIconBtn>
          <FormCardIconBtn label="Preview" onClick={() => navigate(`/forms/${form.id}`)}>
            <IconPreview />
          </FormCardIconBtn>
          <FormCardIconBtn label="Duplicate" onClick={onDuplicate}>
            <IconDuplicate />
          </FormCardIconBtn>
          <FormCardIconBtn label="Delete" danger onClick={onDelete}>
            <IconDelete />
          </FormCardIconBtn>
        </div>
      </div>

      <SharePanel
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        formId={form.id}
        formName={form.name}
        schema={form.schema}
      />
    </div>
  );
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
