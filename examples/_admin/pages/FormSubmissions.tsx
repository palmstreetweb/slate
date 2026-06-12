import { useEffect, useMemo, useState } from 'react';
import type { Question } from '@/index.js';
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
  const [view, setView] = useState<'list' | 'summary'>('list');
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
              className="studio-btn"
              onClick={() => downloadCsv(form.name, answerQuestions(form.schema.questions), subs)}
            >
              Export CSV
            </button>
          )}
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
        {subs.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            <button
              type="button"
              className={`studio-btn${view === 'list' ? ' studio-btn--primary' : ''}`}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setView('list')}
            >
              Responses
            </button>
            <button
              type="button"
              className={`studio-btn${view === 'summary' ? ' studio-btn--primary' : ''}`}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setView('summary')}
            >
              Summary
            </button>
          </div>
        )}
      </div>

      {subs.length === 0 ? (
        <div className="studio-empty">
          <p style={{ margin: 0, fontSize: 14 }}>Empty inbox.</p>
        </div>
      ) : view === 'summary' ? (
        <SummaryView questions={answerQuestions(form.schema.questions)} subs={subs} />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {subs.map((s) => (
            <ResponseRow
              key={s.id}
              sub={s}
              questionIds={answerQuestions(form.schema.questions).map((q) => q.id)}
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

/* ---------- helpers shared by list / summary / export ---------- */

const CHROME_TYPES = new Set(['welcome', 'statement', 'review', 'thanks']);

function answerQuestions(questions: ReadonlyArray<Question>): Question[] {
  return questions.filter((q) => !CHROME_TYPES.has(q.type));
}

/* ---------- CSV export ---------- */

function csvCell(v: unknown): string {
  const s =
    v === undefined || v === null
      ? ''
      : Array.isArray(v)
        ? v.join('; ')
        : typeof v === 'object'
          ? Object.entries(v as Record<string, unknown>)
              .map(([row, col]) => `${row}: ${Array.isArray(col) ? col.join('; ') : String(col)}`)
              .join(' | ')
          : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(
  formName: string,
  questions: Question[],
  subs: StoredSubmission[],
): void {
  const headers = ['submitted_at', 'duration_ms', 'score', ...questions.map((q) => q.id)];
  const rows = subs.map((s) => [
    s.receivedAt,
    String(s.meta.durationMs),
    String(s.meta.score ?? 0),
    ...questions.map((q) => s.answers[q.id]),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${formName.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'responses'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- summary view ---------- */

function titleOf(q: Question): string {
  return typeof q.title === 'string' ? q.title : q.id;
}

/** Distribution counts of option values across submissions. */
function distribution(
  values: unknown[],
  options: ReadonlyArray<{ label: string; value: string }>,
): Array<{ label: string; count: number }> {
  return options.map((opt) => ({
    label: opt.label,
    count: values.filter((v) =>
      Array.isArray(v) ? v.includes(opt.value) : v === opt.value,
    ).length,
  }));
}

function SummaryView({
  questions,
  subs,
}: {
  questions: Question[];
  subs: StoredSubmission[];
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {questions.map((q) => (
        <QuestionSummary key={q.id} question={q} subs={subs} />
      ))}
    </div>
  );
}

function QuestionSummary({ question, subs }: { question: Question; subs: StoredSubmission[] }) {
  const values = subs
    .map((s) => s.answers[question.id])
    .filter((v) => v !== undefined && v !== null && v !== '');
  const answered = values.length;

  let body: React.ReactNode;

  if (
    question.type === 'single_choice' ||
    question.type === 'multi_choice' ||
    question.type === 'dropdown' ||
    question.type === 'picture_choice'
  ) {
    body = <DistributionBars rows={distribution(values, question.options)} total={answered} />;
  } else if (question.type === 'yes_no') {
    body = (
      <DistributionBars
        rows={distribution(values, [
          { label: question.yesLabel ?? 'Yes', value: 'yes' },
          { label: question.noLabel ?? 'No', value: 'no' },
        ])}
        total={answered}
      />
    );
  } else if (question.type === 'legal') {
    body = (
      <DistributionBars
        rows={distribution(values, [
          { label: question.acceptLabel ?? 'Accept', value: 'accept' },
          { label: question.declineLabel ?? 'Decline', value: 'decline' },
        ])}
        total={answered}
      />
    );
  } else if (
    question.type === 'number' ||
    question.type === 'scale' ||
    question.type === 'nps'
  ) {
    const nums = values.filter((v): v is number => typeof v === 'number');
    if (nums.length === 0) {
      body = <Muted>No numeric answers yet.</Muted>;
    } else {
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      body = (
        <p style={{ margin: 0, fontSize: 13 }}>
          avg <strong>{avg.toFixed(1)}</strong> · min {Math.min(...nums)} · max{' '}
          {Math.max(...nums)} · {nums.length} answered
        </p>
      );
    }
  } else if (question.type === 'ranking') {
    const ranked = values.filter((v): v is string[] => Array.isArray(v));
    if (ranked.length === 0) {
      body = <Muted>No rankings yet.</Muted>;
    } else {
      const rows = question.options
        .map((opt) => {
          const positions = ranked
            .map((order) => order.indexOf(opt.value))
            .filter((i) => i >= 0)
            .map((i) => i + 1);
          const avg =
            positions.length > 0
              ? positions.reduce((a, b) => a + b, 0) / positions.length
              : Number.POSITIVE_INFINITY;
          return { label: opt.label, avg };
        })
        .sort((a, b) => a.avg - b.avg);
      body = (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: 'grid', gap: 2 }}>
          {rows.map((r) => (
            <li key={r.label}>
              {r.label}{' '}
              <span style={{ color: 'var(--psw-dim)', fontSize: 11 }}>
                (avg position {Number.isFinite(r.avg) ? r.avg.toFixed(1) : '—'})
              </span>
            </li>
          ))}
        </ol>
      );
    }
  } else {
    body = (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--psw-muted)' }}>
        {answered} of {subs.length} answered
      </p>
    );
  }

  return (
    <div className="studio-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>{titleOf(question)}</strong>
        <span style={{ fontSize: 11, color: 'var(--psw-dim)', fontFamily: 'var(--psw-font-mono)' }}>
          {question.id} · {answered}/{subs.length}
        </span>
      </div>
      {body}
    </div>
  );
}

function DistributionBars({
  rows,
  total,
}: {
  rows: Array<{ label: string; count: number }>;
  total: number;
}) {
  if (total === 0) return <Muted>No answers yet.</Muted>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 8, alignItems: 'center' }}
        >
          <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.label}
          </span>
          <div style={{ background: 'var(--psw-bg)', borderRadius: 4, overflow: 'hidden', height: 14 }}>
            <div
              style={{
                width: `${(r.count / max) * 100}%`,
                height: '100%',
                background: 'var(--psw-accent, #2d5bff)',
                opacity: 0.75,
                borderRadius: 4,
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: 'var(--psw-dim)', textAlign: 'right' }}>
            {r.count} ({total > 0 ? Math.round((r.count / total) * 100) : 0}%)
          </span>
        </div>
      ))}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 13, color: 'var(--psw-muted)' }}>{children}</p>;
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
  const summary = questionIds.slice(0, 2).map((qid) => formatValue(a[qid]));
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
  if (typeof File !== 'undefined' && v instanceof File) {
    return `${v.name} (${Math.round(v.size / 1024)} KB)`;
  }
  if (typeof v === 'object') {
    // Matrix answers: row → column(s).
    return Object.entries(v as Record<string, unknown>)
      .map(([row, col]) => `${row}: ${Array.isArray(col) ? col.join(', ') : String(col)}`)
      .join(' · ');
  }
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
