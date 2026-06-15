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
import {
  formatAnswerForQuestion,
  formatSubmittedAt,
  leadPreview,
  titleOf,
} from '../responsesFormat.js';

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
          <span style={{ color: 'var(--slate-text)' }}>Responses</span>
        </span>
      }
      rightSlot={
        <>
          <button type="button" className="slate-btn" onClick={() => navigate(`/forms/${formId}/edit`)}>
            ← Editor
          </button>
          <button type="button" className="slate-btn" onClick={() => navigate(`/forms/${formId}`)}>
            Preview ↗
          </button>
          {subs.length > 0 && (
            <button
              type="button"
              className="slate-btn"
              onClick={() => downloadCsv(form.name, answerQuestions(form.schema.questions), subs)}
            >
              Export CSV
            </button>
          )}
          {subs.length > 0 && (
            <button
              type="button"
              className="slate-btn slate-btn--danger"
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
        <h1 className="slate-page-title">Responses</h1>
        <p className="slate-page-sub">
          {subs.length === 0
            ? 'Nothing yet — open Preview and submit one to see it here.'
            : `${subs.length} ${subs.length === 1 ? 'response' : 'responses'}`}
        </p>
        {subs.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            <button
              type="button"
              className={`slate-btn slate-btn--compact${view === 'list' ? ' slate-btn--primary' : ''}`}
              onClick={() => setView('list')}
            >
              Responses
            </button>
            <button
              type="button"
              className={`slate-btn slate-btn--compact${view === 'summary' ? ' slate-btn--primary' : ''}`}
              onClick={() => setView('summary')}
            >
              Summary
            </button>
          </div>
        )}
      </div>

      {subs.length === 0 ? (
        <div className="slate-empty">
          <p style={{ margin: 0, fontSize: 15 }}>Empty inbox.</p>
        </div>
      ) : view === 'summary' ? (
        <SummaryView questions={answerQuestions(form.schema.questions)} subs={subs} />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {subs.map((s) => (
            <ResponseRow
              key={s.id}
              sub={s}
              questions={answerQuestions(form.schema.questions)}
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
        <p style={{ margin: 0, fontSize: 14 }}>
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
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: 'grid', gap: 2 }}>
          {rows.map((r) => (
            <li key={r.label}>
              {r.label}{' '}
              <span style={{ color: 'var(--slate-dim)', fontSize: 12 }}>
                (avg position {Number.isFinite(r.avg) ? r.avg.toFixed(1) : '—'})
              </span>
            </li>
          ))}
        </ol>
      );
    }
  } else {
    body = (
      <p style={{ margin: 0, fontSize: 14, color: 'var(--slate-muted)' }}>
        {answered} of {subs.length} answered
      </p>
    );
  }

  return (
    <div className="slate-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>{titleOf(question)}</strong>
        <span style={{ fontSize: 12, color: 'var(--slate-dim)', fontFamily: 'var(--slate-font-mono)' }}>
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
          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.label}
          </span>
          <div style={{ background: 'var(--slate-bg)', borderRadius: 4, overflow: 'hidden', height: 14 }}>
            <div
              style={{
                width: `${(r.count / max) * 100}%`,
                height: '100%',
                background: 'var(--slate-accent, #2d5bff)',
                opacity: 0.75,
                borderRadius: 4,
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: 'var(--slate-dim)', textAlign: 'right' }}>
            {r.count} ({total > 0 ? Math.round((r.count / total) * 100) : 0}%)
          </span>
        </div>
      ))}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14, color: 'var(--slate-muted)' }}>{children}</p>;
}

function ResponseRow({
  sub,
  questions,
  expanded,
  onToggle,
  onDelete,
}: {
  sub: StoredSubmission;
  questions: Question[];
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const a = sub.answers;
  const preview = leadPreview(questions, a);
  const when = new Date(sub.receivedAt);

  return (
    <div className="slate-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} response from ${timeAgo(when)}`}
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
          fontSize: 14,
        }}
      >
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview.primary}
        </span>
        <span style={{ color: 'var(--slate-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview.secondary}
        </span>
        <span style={{ color: 'var(--slate-dim)', fontSize: 12 }}>{humanizeMs(sub.meta.durationMs)}</span>
        <span style={{ color: 'var(--slate-dim)', fontSize: 12, textAlign: 'right' }}>
          {timeAgo(when)}
        </span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--slate-border)', padding: 16, display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--slate-dim)' }}>
            Submitted {formatSubmittedAt(sub.receivedAt)} · took {humanizeMs(sub.meta.durationMs)}
          </p>
          <div style={{ display: 'grid', gap: 14 }}>
            {questions.map((q) => {
              const v = a[q.id];
              return (
                <div key={q.id} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-text)' }}>
                    {titleOf(q)}
                  </span>
                  <span style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--slate-muted)' }}>
                    {formatAnswerForQuestion(q, v)}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--slate-border)', paddingTop: 12 }}>
            <button type="button" className="slate-btn slate-btn--danger" onClick={onDelete}>
              Delete response
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
