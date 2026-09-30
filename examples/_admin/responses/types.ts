/**
 * Prop contracts shared by the Responses page shell and its two views
 * (Inbox split view, Summary first — ADR-055). The page owns loading, the
 * stores and every write; views only render and call back.
 */

import type { Question } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import type { TrackedSource } from '../_formsStore.js';

/** Persisted choice between the two views (`slate-responses-view`). */
export type ResponsesViewName = 'inbox' | 'summary';

export type ResponsesViewCommon = {
  formId: string;
  formName: string;
  /** Answer questions only (no welcome/statement/review/thanks), schema order. */
  questions: Question[];
  /** Newest first — active responses, or trashed ones in trash mode. */
  subs: StoredSubmission[];
  /** Every unread response id in this browser (all forms). */
  unread: ReadonlySet<string>;
  onMarkRead(ids: string[]): void;
  onMarkUnread(id: string): void;
  /** Page trashes immediately and shows a "Moved to trash" toast with Undo. */
  onTrash(id: string): void;
  /** The form's named flyer links, for source labels (ADR-063). */
  trackedSources?: ReadonlyArray<TrackedSource>;
};

export type InboxProps = ResponsesViewCommon & {
  mode: 'responses' | 'trash';
  /** Immediate, with a "Restored" toast. */
  onRestore(id: string): void;
  /** Page asks for confirmation first. */
  onDeleteForever(id: string): void;
  /** Page asks for confirmation first. */
  onRestoreAll(): void;
  /** Page asks for confirmation first. */
  onEmptyTrash(): void;
};

export type SummaryProps = ResponsesViewCommon;

/**
 * One answer-value filter (Summary bars, Inbox chips). `questionId` may be
 * `SOURCE_FILTER_ID` (where the response came from), and `value` may be
 * `OTHER_VALUE` ("typed its own answer") — ADR-063.
 */
export type AnswerFilter = { questionId: string; value: string };

export type DayGroup<T> = {
  /** Stable across renders: `today`, `yesterday`, `week`, `month`, `m-2026-08`. */
  key: string;
  /** `Today`, `Yesterday`, `Last 7 days`, `Earlier this month`, `August`, `August 2025`. */
  label: string;
  items: T[];
};

export type DistributionRow = {
  /** Stored value as a string (option value, `yes`, or a number like `4`). */
  value: string;
  label: string;
  count: number;
  /** Whole percent of respondents who answered this question (0–100). */
  pct: number;
};

export type Distribution = {
  questionId: string;
  /** `choice` rows are sorted by count; `numeric` rows stay in value order. */
  kind: 'choice' | 'numeric';
  /** Responses with any answer to this question. */
  answered: number;
  rows: DistributionRow[];
  /** Largest row count, at least 1 — the 100% bar width. */
  max: number;
  /** Numeric questions only; null when nobody answered. */
  average: number | null;
  /**
   * Choice questions with Other (ADR-063): what people typed, most common
   * first. They are counted together in one "Other" row.
   */
  others?: Array<{ text: string; count: number }>;
  /** Swipe cards (ADR-065): rows are like rates — `pct` is the share who liked that card. */
  likes?: boolean;
};

export type Kpis = {
  total: number;
  /** Unread among `subs` (this form). */
  unread: number;
  /** Since Monday 00:00 local time. */
  thisWeek: number;
  /** The Monday-to-Sunday week before that. */
  lastWeek: number;
  medianMs: number | null;
  /** 14 daily counts, oldest first; the last one is today. */
  spark: number[];
  /** Local midnight of each spark day, same order as `spark`. */
  sparkDays: Date[];
  /** Local midnight of this week's Monday. */
  weekStart: Date;
};

export type TableColumns = {
  /** Up to two choice questions (single/multi/dropdown/picture/yes-no); one when `source` is on. */
  choices: Question[];
  /** A Source column: some response came from a tracked link (ADR-063). */
  source: boolean;
  /** First long_text, else another text question that isn't the name or email. */
  text: Question | null;
  /** `choices` then `text`, for header rows. */
  all: Question[];
};

export type DurationPart = { value: number; unit: 'h' | 'm' | 's' };
