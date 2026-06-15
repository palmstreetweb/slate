/**
 * Pure helpers for the Responses admin view — human labels and type-aware
 * answer formatting. No React; unit-testable.
 */

import type { Question } from '@/index.js';

const CONTACT_PRIORITY = new Set<Question['type']>(['short_text', 'email', 'phone', 'url']);

function titleOf(q: Question): string {
  return typeof q.title === 'string' ? q.title : q.id;
}

function optionLabel(q: Question, value: string): string | null {
  if (!('options' in q) || !Array.isArray(q.options)) return null;
  return q.options.find((o) => o.value === value)?.label ?? null;
}

/** Format one answer for display using question type context. */
export function formatAnswerForQuestion(question: Question, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';

  switch (question.type) {
    case 'single_choice':
    case 'dropdown':
    case 'picture_choice':
      if (typeof value === 'string') return optionLabel(question, value) ?? value;
      return String(value);

    case 'multi_choice':
      if (Array.isArray(value)) {
        return value
          .map((v) => (typeof v === 'string' ? optionLabel(question, v) ?? v : String(v)))
          .join(', ');
      }
      return String(value);

    case 'yes_no':
      if (value === 'yes') return question.yesLabel ?? 'Yes';
      if (value === 'no') return question.noLabel ?? 'No';
      return String(value);

    case 'legal':
      if (value === 'accept') return question.acceptLabel ?? 'Accept';
      if (value === 'decline') return question.declineLabel ?? 'Decline';
      return String(value);

    case 'ranking':
      if (Array.isArray(value) && 'options' in question) {
        return value
          .map((v, i) => {
            const label = optionLabel(question, String(v)) ?? String(v);
            return `${i + 1}. ${label}`;
          })
          .join('\n');
      }
      return Array.isArray(value) ? value.join(', ') : String(value);

    case 'matrix':
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return Object.entries(value as Record<string, unknown>)
          .map(([row, col]) => `${row}: ${Array.isArray(col) ? col.join(', ') : String(col)}`)
          .join('\n');
      }
      return String(value);

    case 'file_upload':
      if (typeof File !== 'undefined' && value instanceof File) {
        return `${value.name} (${Math.round(value.size / 1024)} KB)`;
      }
      return String(value);

    default:
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
}

type LeadPreview = { primary: string; secondary: string };

/** Pick two human-readable preview strings for a collapsed response row. */
export function leadPreview(questions: ReadonlyArray<Question>, answers: Record<string, unknown>): LeadPreview {
  const answered = questions.filter((q) => {
    const v = answers[q.id];
    return v !== undefined && v !== null && v !== '';
  });

  const score = (q: Question): number => {
    if (q.type === 'short_text') return 10;
    if (q.type === 'email') return 9;
    if (q.type === 'phone') return 8;
    if (CONTACT_PRIORITY.has(q.type)) return 7;
    if (q.type === 'single_choice' || q.type === 'dropdown') return 6;
    return 1;
  };

  const sorted = [...answered].sort((a, b) => score(b) - score(a));
  const primary = sorted[0] ? formatAnswerForQuestion(sorted[0], answers[sorted[0].id]) : '—';
  const secondary = sorted[1] ? formatAnswerForQuestion(sorted[1], answers[sorted[1].id]) : '—';

  return {
    primary: primary === '—' ? '—' : primary.split('\n')[0] ?? '—',
    secondary: secondary === '—' ? '—' : secondary.split('\n')[0] ?? '—',
  };
}

export function formatSubmittedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export { titleOf };
