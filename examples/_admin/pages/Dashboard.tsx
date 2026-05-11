import { useEffect, useState } from 'react';
import { defineSchema } from '@/index.js';
import {
  createForm,
  deleteForm,
  duplicateForm,
  listForms,
  subscribe,
  type FormRecord,
} from '../_formsStore.js';
import { countSubmissions, lastSubmissionAt } from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { AdminShell } from '../shell/AdminShell.js';

export function Dashboard() {
  const [forms, setForms] = useState<FormRecord[]>(() => listForms());

  useEffect(() => subscribe(setForms), []);

  const onNew = () => {
    const created = createForm({
      name: 'Untitled form',
      schema: defineSchema({
        brand: { name: 'Untitled' },
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
      crumbs={<span className="studio-crumb">Forms</span>}
      rightSlot={
        <button type="button" className="studio-btn studio-btn--primary" onClick={onNew}>
          + New form
        </button>
      }
    >
      <div style={{ marginBottom: 28 }}>
        <h1 className="studio-page-title">Your forms</h1>
        <p className="studio-page-sub">
          {forms.length === 0 ? 'No forms yet.' : `${forms.length} ${forms.length === 1 ? 'form' : 'forms'}`}
        </p>
      </div>

      {forms.length === 0 ? (
        <div className="studio-empty">
          <p style={{ margin: '0 0 12px', fontSize: 14 }}>No forms yet.</p>
          <button type="button" className="studio-btn studio-btn--primary" onClick={onNew}>
            Create your first form
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
            <FormCard key={f.id} form={f} onDuplicate={() => duplicateForm(f.id)} onDelete={() => {
              if (confirm(`Delete "${f.name}"? This also deletes its submissions in localStorage.`)) {
                deleteForm(f.id);
              }
            }} />
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
  const subCount = countSubmissions(form.id);
  const lastAt = lastSubmissionAt(form.id);
  const qCount = form.schema.questions.filter(
    (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
  ).length;

  return (
    <div className="studio-card">
      <div className="studio-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <button
            type="button"
            className="studio-link"
            style={{
              fontFamily: 'var(--psw-font-display)',
              fontSize: 19,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              color: 'var(--psw-text)',
              display: 'block',
              textAlign: 'left',
              lineHeight: 1.15,
            }}
            onClick={() => navigate(`/forms/${form.id}/edit`)}
          >
            {form.name}
          </button>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--psw-dim)' }}>
            {form.schema.brand.name} · {String(form.schema.theme)}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="studio-badge">{qCount} {qCount === 1 ? 'question' : 'questions'}</span>
          <span className="studio-badge">
            {subCount} {subCount === 1 ? 'response' : 'responses'}
          </span>
          {lastAt && (
            <span className="studio-badge">last {timeAgo(new Date(lastAt))}</span>
          )}
        </div>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--psw-border)',
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          background: 'var(--psw-bg)',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="studio-btn studio-btn--ghost"
            onClick={() => navigate(`/forms/${form.id}/edit`)}
          >
            Edit
          </button>
          <button
            type="button"
            className="studio-btn studio-btn--ghost"
            onClick={() => navigate(`/forms/${form.id}`)}
          >
            Preview
          </button>
          <button
            type="button"
            className="studio-btn studio-btn--ghost"
            onClick={() => navigate(`/forms/${form.id}/submissions`)}
          >
            Responses
            {subCount > 0 && (
              <span
                className="studio-badge studio-badge--accent"
                style={{ padding: '0 6px', fontSize: 10, marginLeft: 4 }}
              >
                {subCount}
              </span>
            )}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="studio-btn studio-btn--ghost studio-btn--icon" onClick={onDuplicate} aria-label="Duplicate" title="Duplicate">
            <DuplicateIcon />
          </button>
          <button type="button" className="studio-btn studio-btn--ghost studio-btn--icon" onClick={onDelete} aria-label="Delete" title="Delete">
            <TrashIcon />
          </button>
        </div>
      </div>
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
