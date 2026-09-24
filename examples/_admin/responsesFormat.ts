/**
 * Pure helpers for the Responses admin view — human labels and type-aware
 * answer formatting. No React; unit-testable.
 */

import type { Question } from '@/index.js';
import { describeFileUploadAnswer, isFileUploadRef } from '@/index.js';
import { peekLocalUploadMeta } from './localFileStore.js';
import { safeText } from './answerShape.js';

const CONTACT_PRIORITY = new Set<Question['type']>(['short_text', 'email', 'phone', 'url']);

function titleOf(q: Question): string {
  return typeof q.title === 'string' ? q.title : q.id;
}

function optionLabel(q: Question, value: string): string | null {
  if (!('options' in q) || !Array.isArray(q.options)) return null;
  return q.options.find((o) => o.value === value)?.label ?? null;
}

/**
 * Format one answer for display using question type context. Total: answers
 * come from anonymous respondents, so a hostile value falls back to plain text
 * instead of throwing during render (audit H1).
 */
export function formatAnswerForQuestion(question: Question, value: unknown): string {
  try {
    return formatAnswer(question, value);
  } catch {
    return safeText(value) || '—';
  }
}

function formatAnswer(question: Question, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';

  switch (question.type) {
    case 'single_choice':
    case 'dropdown':
    case 'picture_choice':
      if (typeof value === 'string') return optionLabel(question, value) ?? value;
      return safeText(value);

    case 'multi_choice':
      if (Array.isArray(value)) {
        return value
          .map((v) => (typeof v === 'string' ? (optionLabel(question, v) ?? v) : safeText(v)))
          .join(', ');
      }
      return safeText(value);

    case 'yes_no':
      if (value === 'yes') return question.yesLabel ?? 'Yes';
      if (value === 'no') return question.noLabel ?? 'No';
      return safeText(value);

    case 'legal':
      if (value === 'accept') return question.acceptLabel ?? 'Accept';
      if (value === 'decline') return question.declineLabel ?? 'Decline';
      return safeText(value);

    case 'ranking':
      if (Array.isArray(value) && 'options' in question) {
        return value
          .map((v, i) => {
            const label = optionLabel(question, safeText(v)) ?? safeText(v);
            return `${i + 1}. ${label}`;
          })
          .join('\n');
      }
      return safeText(value);

    case 'matrix':
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        'rows' in question
      ) {
        return Object.entries(value as Record<string, unknown>)
          .map(([rowVal, col]) => {
            const rowLabel =
              question.rows.find((r) => r.value === rowVal)?.label ?? safeText(rowVal);
            const colVal = Array.isArray(col) ? col[0] : col;
            const colLabel =
              typeof colVal === 'string' && 'columns' in question
                ? (question.columns.find((c) => c.value === colVal)?.label ?? safeText(colVal))
                : safeText(col);
            return `${rowLabel}: ${colLabel}`;
          })
          .join('\n');
      }
      return safeText(value);

    case 'file_upload':
      if (Array.isArray(value)) {
        return (
          value
            .map((item) => {
              if (typeof File !== 'undefined' && item instanceof File) {
                return `${item.name} (${Math.round(item.size / 1024)} KB)`;
              }
              if (typeof item === 'string' && isFileUploadRef(item)) {
                return describeFileUploadAnswer(item, peekLocalUploadMeta(item)) ?? 'Uploaded file';
              }
              if (typeof item === 'string') {
                return describeFileUploadAnswer(item) ?? item;
              }
              return safeText(item);
            })
            .join('\n') || '—'
        );
      }
      if (typeof File !== 'undefined' && value instanceof File) {
        return `${value.name} (${Math.round(value.size / 1024)} KB)`;
      }
      if (typeof value === 'string' && isFileUploadRef(value)) {
        return describeFileUploadAnswer(value, peekLocalUploadMeta(value)) ?? 'Uploaded file';
      }
      if (typeof value === 'string') {
        return describeFileUploadAnswer(value) ?? value;
      }
      return safeText(value);

    default:
      return safeText(value);
  }
}

type LeadPreview = { primary: string; secondary: string };

/** Pick two human-readable preview strings for a collapsed response row. */
export function leadPreview(
  questions: ReadonlyArray<Question>,
  answers: Record<string, unknown>,
): LeadPreview {
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
    primary: primary === '—' ? '—' : (primary.split('\n')[0] ?? '—'),
    secondary: secondary === '—' ? '—' : (secondary.split('\n')[0] ?? '—'),
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

/** Human label for how many people answered a question in Summary. */
export function completionLabel(answered: number, total: number): string {
  if (total === 0) return 'No responses yet';
  if (answered === 0) return total === 1 ? 'Not answered' : `Not answered · ${total} responses`;
  if (answered === total) {
    return total === 1 ? 'Answered' : `All ${total} answered`;
  }
  return `${answered} of ${total} answered`;
}

/** Compact duration for exports and list rows. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m} min ${rem} sec` : `${m} min`;
}

/** Spreadsheet-friendly answer text — labels, no em dashes, single-line cells. */
export function formatAnswerForCsv(question: Question, value: unknown): string {
  const formatted = formatAnswerForQuestion(question, value);
  if (formatted === '—') return '';
  return formatted.replace(/\n/g, '; ');
}

export { titleOf };

/**
 * Compact age for the notifications list: `2m`, `1h`, `Yesterday`, `Sep 19`.
 * Year is only shown once the date is out of the current year.
 */
export function formatRelativeAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const diffMs = now.getTime() - then.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (then >= startOfYesterday && then < startOfToday) return 'Yesterday';
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
