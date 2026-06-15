/**
 * Human-readable CSV export for form responses. Pure helpers; unit-tested.
 */

import type { Question } from '@/index.js';
import type { StoredSubmission } from './_submissionStore.js';
import {
  formatAnswerForCsv,
  formatDurationMs,
  formatSubmittedAt,
  titleOf,
} from './responsesFormat.js';

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Keep column titles readable when two questions share the same title. */
export function uniqueColumnTitles(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base = title.trim() || 'Question';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    return `${base} (${count + 1})`;
  });
}

export function buildResponsesCsv(questions: Question[], subs: StoredSubmission[]): string {
  const questionHeaders = uniqueColumnTitles(questions.map((q) => titleOf(q)));
  const headers = ['Submitted', 'Time spent', 'Score', ...questionHeaders];

  const rows = subs.map((s) => [
    formatSubmittedAt(s.receivedAt),
    formatDurationMs(s.meta.durationMs),
    s.meta.score != null ? String(s.meta.score) : '',
    ...questions.map((q) => formatAnswerForCsv(q, s.answers[q.id])),
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function responsesCsvFilename(formName: string): string {
  const base = formName.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'responses';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base} — responses ${stamp}.csv`;
}

export function downloadResponsesCsv(
  formName: string,
  questions: Question[],
  subs: StoredSubmission[],
): void {
  const csv = buildResponsesCsv(questions, subs);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = responsesCsvFilename(formName);
  a.click();
  URL.revokeObjectURL(url);
}
