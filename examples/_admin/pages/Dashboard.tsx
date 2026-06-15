import { useEffect, useState } from 'react';
import { defineSchema } from '@/index.js';
import {
  createForm,
  deleteForm,
  duplicateForm,
  listForms,
  subscribe,
  updateForm,
  type FormRecord,
} from '../_formsStore.js';
import { countSubmissions, lastSubmissionAt } from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { SharePanel } from '../components/SharePanel.js';
import { slugify } from '../shareUrls.js';
import { AdminShell } from '../shell/AdminShell.js';

export function Dashboard() {
  const [forms, setForms] = useState<FormRecord[]>(() => listForms());
  const confirm = useConfirm();

  useEffect(() => subscribe(setForms), []);

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
    navigate(`/forms/${created.id}/edit`);
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
      <div style={{ marginBottom: 28 }}>
        <h1 className="slate-page-title">Your forms</h1>
        <p className="slate-page-sub">
          {forms.length === 0 ? 'No forms yet.' : `${forms.length} ${forms.length === 1 ? 'form' : 'forms'}`}
        </p>
      </div>

      {forms.length === 0 ? (
        <div className="slate-empty">
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>No forms yet.</p>
          <button type="button" className="slate-btn slate-btn--new" onClick={onNew}>
            <span className="slate-btn-plus">+</span> Create your first form
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {forms.map((f) => (
            <FormCard
              key={f.id}
              form={f}
              onDuplicate={() => duplicateForm(f.id)}
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
  const slug = form.slug?.trim() ? slugify(form.slug) : slugify(form.name);

  return (
    <div className="slate-card">
      <div className="slate-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <button
            type="button"
            className="slate-link slate-card-title"
            onClick={() => navigate(`/forms/${form.id}/edit`)}
          >
            {form.name}
          </button>
          <p className="slate-card-meta">
            {form.schema.brand.name} · {String(form.schema.theme)}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="slate-badge">{qCount} {qCount === 1 ? 'question' : 'questions'}</span>
          <span className="slate-badge">
            {subCount} {subCount === 1 ? 'response' : 'responses'}
          </span>
          {lastAt && (
            <span className="slate-badge">last {timeAgo(new Date(lastAt))}</span>
          )}
        </div>
      </div>

      <div className="slate-card-footer">
        <div className="slate-card-actions">
          <button
            type="button"
            className="slate-card-action"
            onClick={() => navigate(`/forms/${form.id}/edit`)}
          >
            Edit
          </button>
          <button
            type="button"
            className="slate-card-action"
            onClick={() => navigate(`/forms/${form.id}`)}
          >
            Preview
          </button>
          <button
            type="button"
            className="slate-card-action"
            onClick={() => navigate(`/forms/${form.id}/submissions`)}
          >
            Responses
            {subCount > 0 && (
              <span
                className="slate-badge slate-badge--accent"
                style={{ padding: '0 6px', fontSize: 10, marginLeft: 6 }}
              >
                {subCount}
              </span>
            )}
          </button>
          <button type="button" className="slate-card-action" onClick={() => setShareOpen(true)}>
            Share
          </button>
        </div>
        <div className="slate-card-icons">
          <button type="button" className="slate-card-icon-btn" onClick={onDuplicate} aria-label="Duplicate" title="Duplicate">
            <DuplicateIcon />
          </button>
          <button type="button" className="slate-card-icon-btn" onClick={onDelete} aria-label="Delete" title="Delete">
            <TrashIcon />
          </button>
        </div>
      </div>

      <SharePanel
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        formId={form.id}
        formName={form.name}
        slug={slug}
        onSlugChange={(next) => updateForm(form.id, { slug: slugify(next) })}
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

function DuplicateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
