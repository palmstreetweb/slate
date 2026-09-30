/**
 * Human-readable CSV export for form responses. Pure helpers; unit-tested.
 */

import type { Question } from '@/index.js';
import type { StoredSubmission } from './_submissionStore.js';
import type { TrackedSource } from './_formsStore.js';
import { sourceLabel, sourceOf } from './trackedLinks.js';
import {
  csvParts,
  formatAnswerForCsv,
  formatAnswerForQuestion,
  formatDurationMs,
  formatSubmittedAt,
  titleOf,
} from './responsesFormat.js';

/**
 * Spreadsheets execute cells that start with = + - @ (and tab / CR). Prefix
 * those with an apostrophe so a respondent can't plant a formula in an export.
 * Plain negative numbers are left alone.
 */
function defuseFormula(v: string): string {
  if (/^[=@\t\r]/.test(v)) return `'${v}`;
  if (/^[+-]/.test(v) && !/^[+-]?\d[\d.,]*$/.test(v)) return `'${v}`;
  return v;
}

function csvCell(raw: string): string {
  const v = defuseFormula(raw);
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

type CsvColumn = {
  id: string;
  title: string;
  question: Question | null;
  /** One part of a multi-part answer (contact, address — ADR-064). */
  cell?: (value: unknown) => string;
};

/** Schema questions plus any answer keys that no longer exist on the form. */
export function buildCsvColumns(questions: Question[], subs: StoredSubmission[]): CsvColumn[] {
  const known = new Set(questions.map((q) => q.id));
  const extraIds: string[] = [];
  for (const s of subs) {
    for (const id of Object.keys(s.answers ?? {})) {
      if (!known.has(id) && !extraIds.includes(id)) extraIds.push(id);
    }
  }
  return [
    ...questions.flatMap((q): CsvColumn[] => {
      // A contact block or an address gets a column per part (ADR-064).
      const parts = csvParts(q, subs);
      if (!parts) return [{ id: q.id, title: titleOf(q), question: q }];
      return parts.map((p) => ({
        id: q.id,
        title: `${titleOf(q)} — ${p.label}`,
        question: q,
        cell: p.cell,
      }));
    }),
    ...extraIds.map((id) => ({
      id,
      title: `(removed) ${id}`,
      question: null,
    })),
  ];
}

function formatCell(column: CsvColumn, value: unknown): string {
  if (column.cell) return column.cell(value);
  if (column.question) return formatAnswerForCsv(column.question, value);
  if (value === undefined || value === null || value === '') return '';
  // Best-effort for removed questions (may still be a file ref).
  const stub = {
    id: column.id,
    type: 'short_text',
    title: column.title,
  } as Question;
  return formatAnswerForQuestion(stub, value).replace(/\n/g, '; ');
}

export function buildResponsesCsv(
  questions: Question[],
  subs: StoredSubmission[],
  trackedSources?: ReadonlyArray<TrackedSource>,
): string {
  const columns = buildCsvColumns(questions, subs);
  const questionHeaders = uniqueColumnTitles(columns.map((c) => c.title));
  // Instant estimate (ADR-064): plain numbers, low and high, when any response has one.
  const estimated = subs.find((s) => s.meta?.estimate)?.meta.estimate;
  const estimateHeaders = estimated
    ? [`Estimate low (${estimated.currency})`, `Estimate high (${estimated.currency})`]
    : [];
  // Where each response came from (ADR-063): the tracked link's name, "Direct" otherwise.
  const headers = [
    'Submitted',
    'Time spent',
    'Score',
    ...estimateHeaders,
    'Source',
    ...questionHeaders,
  ];

  const rows = subs.map((s) => [
    formatSubmittedAt(s.receivedAt),
    formatDurationMs(s.meta.durationMs),
    s.meta.score != null ? String(s.meta.score) : '',
    ...(estimated
      ? s.meta?.estimate
        ? [String(s.meta.estimate.low), String(s.meta.estimate.high)]
        : ['', '']
      : []),
    sourceLabel(sourceOf(s.meta?.hiddenFields), trackedSources),
    ...columns.map((c) => formatCell(c, s.answers[c.id])),
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
  trackedSources?: ReadonlyArray<TrackedSource>,
): void {
  const csv = buildResponsesCsv(questions, subs, trackedSources);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = responsesCsvFilename(formName);
  a.click();
  URL.revokeObjectURL(url);
}
