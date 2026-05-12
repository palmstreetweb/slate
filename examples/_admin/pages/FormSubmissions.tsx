import { useEffect, useMemo, useState } from 'react';
import { getForm } from '../_formsStore.js';
import {
  clearSubmissions,
  deleteSubmission,
  listSubmissions,
  subscribe,
  type StoredSubmission,
} from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { AdminShell } from '../shell/AdminShell.js';

type Props = { formId: string };

export function FormSubmissions({ formId }: Props) {
  const form = useMemo(() => getForm(formId), [formId]);
  const [subs, setSubs] = useState<StoredSubmission[]>(() => listSubmissions(formId));
  const [open, setOpen] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(
    () => subscribe(() => setSubs(listSubmissions(formId))),
    [formId],
  );

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
          <span style={{ color: 'var(--psw-text)' }}>Responses</span>
        </span>
      }
      rightSlot={
        <>
          <button type="button" className="studio-btn" onClick={() => navigate(`/forms/${formId}/edit`)}>
            ← Editor
          </button>
          <button type="button" className="studio-btn" onClick={() => navigate(`/forms/${formId}`)}>
            Preview ↗
          </button>
          {subs.length > 0 && (
            <button
              type="button"
              className="studio-btn studio-btn--danger"
              onClick={async () => {
                const ok = await confirm({
                  title: `Clear ${subs.length} ${subs.length === 1 ? 'response' : 'responses'}?`,
                  message: `Permanently deletes all responses for "${form.name}" from localStorage. The form itself is kept.`,
                  confirmLabel: 'Clear all',
                  danger: true,
                });
                if (ok) clearSubmissions(formId);
              }}
            >
              Clear all
            </button>
          )}
        </>
      }
    >
      <div style={{ marginBottom: 24 }}>
        <h1 className="studio-page-title">Responses</h1>
        <p className="studio-page-sub">
          {subs.length === 0
            ? 'Nothing yet — open Preview and submit one to see it here.'
            : `${subs.length} ${subs.length === 1 ? 'response' : 'responses'}`}
        </p>
      </div>

      {subs.length === 0 ? (
        <div className="studio-empty">
          <p style={{ margin: 0, fontSize: 14 }}>Empty inbox.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {subs.map((s) => (
            <ResponseRow
              key={s.id}
              sub={s}
              questionIds={form.schema.questions
                .filter((q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement')
                .map((q) => q.id)}
              expanded={open === s.id}
              onToggle={() => setOpen(open === s.id ? null : s.id)}
              onDelete={async () => {
                const ok = await confirm({
                  title: 'Delete this response?',
                  message: "Removes a single submission. Won't affect other responses.",
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) deleteSubmission(s.id);
              }}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function ResponseRow({
  sub,
  questionIds,
  expanded,
  onToggle,
  onDelete,
}: {
  sub: StoredSubmission;
  questionIds: string[];
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const a = sub.answers;
  const summary = questionIds.slice(0, 2).map((qid) => {
    const v = a[qid];
    return v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v);
  });
  const when = new Date(sub.receivedAt);

  return (
    <div className="studio-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '1.5fr 1.5fr 1fr auto',
          gap: 16,
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary[0] || '—'}
        </span>
        <span style={{ color: 'var(--psw-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary[1] || '—'}
        </span>
        <span style={{ color: 'var(--psw-dim)', fontSize: 11 }}>{humanizeMs(sub.meta.durationMs)}</span>
        <span style={{ color: 'var(--psw-dim)', fontSize: 11, textAlign: 'right' }}>
          {timeAgo(when)}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--psw-border)', padding: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            {questionIds.map((qid) => {
              const v = a[qid];
              return (
                <div key={qid} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12 }}>
                  <span style={{ fontSize: 11, color: 'var(--psw-dim)', fontFamily: 'var(--psw-font-mono)', paddingTop: 2 }}>
                    {qid}
                  </span>
                  <span style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {formatValue(v)}
                  </span>
                </div>
              );
            })}
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--psw-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Meta + raw payload
            </summary>
            <pre
              style={{
                marginTop: 8,
                background: 'var(--psw-bg)',
                border: '1px solid var(--psw-border)',
                padding: 12,
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.5,
                overflow: 'auto',
                maxHeight: 280,
              }}
            >
{JSON.stringify({ answers: a, meta: sub.meta }, null, 2)}
            </pre>
          </details>

          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--psw-border)', paddingTop: 12 }}>
            <button type="button" className="studio-btn studio-btn--danger" onClick={onDelete}>
              Delete response
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function humanizeMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
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
