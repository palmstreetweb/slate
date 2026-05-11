/**
 * PSW dev-only inbox. Lists all submissions captured by the contact form
 * via _submissionStore. In production the real inbox is whatever DB or
 * email tool you wire `/api/contact` into (Supabase admin, Resend audit
 * log, your own Notion table, etc.) — this view only exists so you can
 * iterate on the form questions and see the resulting payload shape
 * without leaving the dev server.
 */

import { useEffect, useState } from 'react';
import {
  clearSubmissions,
  listSubmissions,
  subscribe,
  type StoredSubmission,
} from './_submissionStore.js';

export function PSWInbox() {
  const [subs, setSubs] = useState<StoredSubmission[]>(() => listSubmissions());
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => subscribe(setSubs), []);

  const empty = subs.length === 0;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#f2efe3',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '64px 32px 32px',
      }}
    >
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 32,
            paddingBottom: 16,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                margin: 0,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              psw inbox
            </h1>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 11,
                opacity: 0.55,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              dev-only · localStorage · {subs.length}{' '}
              {subs.length === 1 ? 'submission' : 'submissions'}
            </p>
          </div>
          {!empty && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Clear all ${subs.length} submissions?`)) clearSubmissions();
              }}
              style={pillBtn}
            >
              clear all
            </button>
          )}
        </header>

        {empty ? (
          <EmptyState />
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {subs.map((s) => (
              <li key={s.id}>
                <Row sub={s} expanded={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
              </li>
            ))}
          </ul>
        )}

        <footer style={{ marginTop: 48, opacity: 0.4, fontSize: 11, lineHeight: 1.6 }}>
          this view persists to <code>localStorage[&apos;psw-contact-submissions&apos;]</code>.{' '}
          in psw v2 prod, swap <code>addSubmission()</code> in <code>psw-contact.tsx</code> for a{' '}
          <code>fetch(&apos;/api/contact&apos;)</code> call and serve the inbox from your backend
          of choice (supabase has a free admin ui, resend has an audit log, etc.).
        </footer>
      </div>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.18)',
  color: '#f2efe3',
  fontFamily: 'inherit',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '6px 14px',
  borderRadius: 999,
  cursor: 'pointer',
};

function EmptyState() {
  return (
    <div
      style={{
        border: '1px dashed rgba(255,255,255,0.14)',
        borderRadius: 8,
        padding: '64px 24px',
        textAlign: 'center',
        opacity: 0.7,
      }}
    >
      <p style={{ margin: 0, fontSize: 14, marginBottom: 8 }}>no submissions yet.</p>
      <p style={{ margin: 0, fontSize: 11, opacity: 0.6 }}>
        switch to the &quot;PSW contact&quot; tab, fill out the form, and come back.
      </p>
    </div>
  );
}

function Row({
  sub,
  expanded,
  onToggle,
}: {
  sub: StoredSubmission;
  expanded: boolean;
  onToggle: () => void;
}) {
  const a = sub.answers;
  const name = (a.name as string) ?? 'Anonymous';
  const email = (a.email as string) ?? '—';
  const project = humanize('project_type', a.project_type as string);
  const budget = humanize('budget', a.budget as string);
  const when = new Date(sub.receivedAt);

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          padding: '14px 18px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '1.4fr 1.6fr 1fr 1fr auto',
          gap: 16,
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span style={{ opacity: 0.7 }}>{email}</span>
        <span style={{ opacity: 0.7 }}>{project}</span>
        <span style={{ opacity: 0.55, fontSize: 11 }}>{budget}</span>
        <span style={{ opacity: 0.45, fontSize: 11, textAlign: 'right' }}>
          {timeAgo(when)}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            padding: '14px 18px 18px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            fontSize: 12,
            display: 'grid',
            gap: 14,
          }}
        >
          {a.message ? (
            <Field label="message">
              <pre
                style={{
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  lineHeight: 1.5,
                  background: 'rgba(0,0,0,0.4)',
                  padding: 12,
                  borderRadius: 6,
                }}
              >
                {String(a.message)}
              </pre>
            </Field>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="company">{(a.company as string) || '—'}</Field>
            <Field label="referral">{humanize('referral', a.referral as string) || '—'}</Field>
            <Field label="timeline">{humanize('timeline', a.timeline as string) || '—'}</Field>
            <Field label="duration">{humanizeMs(sub.meta.durationMs)}</Field>
          </div>

          <Field label="meta.questionsVisited">
            <span style={{ opacity: 0.7 }}>{sub.meta.questionsVisited.join(' → ')}</span>
          </Field>

          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', opacity: 0.6, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              raw payload
            </summary>
            <pre
              style={{
                marginTop: 8,
                background: 'rgba(0,0,0,0.55)',
                padding: 12,
                borderRadius: 6,
                fontSize: 11,
                lineHeight: 1.5,
                overflow: 'auto',
                maxHeight: 320,
              }}
            >
              {JSON.stringify({ answers: a, meta: sub.meta }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          opacity: 0.45,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

const LABELS: Record<string, Record<string, string>> = {
  project_type: {
    new_site: 'New site',
    redesign: 'Redesign',
    web_app: 'Web app',
    form_only: 'Form only',
    discovery: 'Discovery',
  },
  budget: {
    lt_5k: '< $5K',
    '5_15k': '$5–15K',
    '15_40k': '$15–40K',
    gt_40k: '$40K+',
    tbd: 'TBD',
  },
  timeline: {
    asap: 'ASAP',
    '1mo': '< 1 month',
    '1_3mo': '1–3 months',
    gt_3mo: '3+ months',
    flex: 'Flexible',
  },
  referral: {
    google: 'Google',
    word_of_mouth: 'Word of mouth',
    social: 'Social',
    portfolio: 'Portfolio',
    other: 'Other',
  },
};

function humanize(field: string, value: string | undefined): string {
  if (!value) return '';
  return LABELS[field]?.[value] ?? value;
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
