/**
 * Pure helpers for the Responses views (ADR-055): who answered, when, what
 * the answers add up to, and what a search or filter matches. No React, no
 * DOM, no stores. Respondent text is untrusted — everything here returns
 * plain strings for React to render as text, never markup.
 */

import type { Question } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { formatAnswerForQuestion, formatRelativeAge, titleOf } from '../responsesFormat.js';
import type {
  AnswerFilter,
  DayGroup,
  Distribution,
  DistributionRow,
  DurationPart,
  Kpis,
  TableColumns,
} from './types.js';

type AnswerMap = Readonly<Record<string, unknown>>;

const DAY_MS = 86_400_000;
const NAME_MAX = 120;
const FIRST_NAME_MAX = 24;

/** Welcome / statement / review / thanks screens store no answer. */
const CHROME_TYPES = new Set<Question['type']>(['welcome', 'statement', 'review', 'thanks']);

/** Questions that carry an answer, in schema order. */
export function answerQuestions(questions: ReadonlyArray<Question>): Question[] {
  return questions.filter((q) => !CHROME_TYPES.has(q.type));
}

/** Compact age: `now`, `2m`, `1h`, `Yesterday`, `Sep 19`. */
export const relativeAge = formatRelativeAge;

export function isBlankAnswer(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && !(typeof File !== 'undefined' && value instanceof File)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/* ---------- who answered ---------- */

const NAME_TITLE = /\b(name|surname)\b/i;
/** "Company name", "Pet's name"… are names, just not the respondent's. */
const NOT_A_PERSON =
  /\b(company|business|organi[sz]ation|project|team|pet|dog|cat|product|brand|school|street|event|site|website|domain|store|shop|restaurant|venue|user|file|app|account)\b/i;
const FIRST_TITLE = /\bfirst\b/i;
const LAST_TITLE = /\b(last|family|surname)\b/i;
const EMAIL_TITLE = /\be-?mail\b/i;

function looksLikeNameQuestion(q: Question): boolean {
  if (q.type !== 'short_text') return false;
  const title = titleOf(q);
  return NAME_TITLE.test(title) && !NOT_A_PERSON.test(title);
}

/** The question most likely to hold the respondent's name, if any. */
export function nameQuestion(questions: ReadonlyArray<Question>): Question | null {
  return (
    questions.find(looksLikeNameQuestion) ?? questions.find((q) => q.type === 'short_text') ?? null
  );
}

/** The question most likely to hold the respondent's email, if any. */
export function emailQuestion(questions: ReadonlyArray<Question>): Question | null {
  return (
    questions.find((q) => q.type === 'email') ??
    questions.find((q) => q.type === 'short_text' && EMAIL_TITLE.test(titleOf(q))) ??
    null
  );
}

function textAnswer(answers: AnswerMap, q: Question): string {
  const v = answers[q.id];
  return typeof v === 'string' ? oneLine(v) : '';
}

/**
 * What the respondent called themselves: the first answered name-like short
 * text (joined with a "last name" answer when the form splits them), else
 * the first answered short text, else the email's local part. Null when the
 * response is anonymous.
 */
export function namedRespondent(
  questions: ReadonlyArray<Question>,
  answers: AnswerMap,
): string | null {
  const named = questions.filter(looksLikeNameQuestion);
  const first = named.find((q) => textAnswer(answers, q));
  if (first) {
    let name = textAnswer(answers, first);
    if (FIRST_TITLE.test(titleOf(first))) {
      const last = named.find(
        (q) => q !== first && LAST_TITLE.test(titleOf(q)) && textAnswer(answers, q),
      );
      if (last) name = `${name} ${textAnswer(answers, last)}`;
    }
    return clip(name, NAME_MAX);
  }
  const anyText = questions.find((q) => q.type === 'short_text' && textAnswer(answers, q));
  if (anyText) return clip(textAnswer(answers, anyText), NAME_MAX);
  const email = respondentEmail(questions, answers);
  if (email) return email.slice(0, email.indexOf('@'));
  return null;
}

/**
 * Display name for a response: `namedRespondent`, else `Response #n` where
 * n is `fallbackIndex` (1-based, oldest first).
 */
export function respondentName(
  questions: ReadonlyArray<Question>,
  answers: AnswerMap,
  fallbackIndex: number,
): string {
  return namedRespondent(questions, answers) ?? `Response #${fallbackIndex}`;
}

/**
 * Strict allow-list for addresses we put in a `mailto:` link. Anything that
 * could add a header, a second recipient or a scheme (`?`, `&`, `#`, `:`,
 * `%`, `,`, `;`, spaces, a second `@`) fails, and so does anything exotic —
 * those responses simply get no Reply button.
 */
const SAFE_EMAIL =
  /^[A-Za-z0-9](?:[A-Za-z0-9._+'-]{0,63})@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function isSafeEmail(value: string): boolean {
  if (value.length > 254) return false;
  if (/[\s:?#&%,;/\\<>"()[\]]/.test(value)) return false;
  if (value.indexOf('@') !== value.lastIndexOf('@')) return false;
  return SAFE_EMAIL.test(value);
}

/** First answered email that passes `isSafeEmail`, else null. */
export function respondentEmail(
  questions: ReadonlyArray<Question>,
  answers: AnswerMap,
): string | null {
  const candidates = [
    ...questions.filter((q) => q.type === 'email'),
    ...questions.filter((q) => q.type === 'short_text' && EMAIL_TITLE.test(titleOf(q))),
  ];
  for (const q of candidates) {
    const v = answers[q.id];
    if (typeof v !== 'string') continue;
    const email = v.trim();
    if (isSafeEmail(email)) return email;
  }
  return null;
}

/** `mailto:` link with subject "Re: {form name}", or null for an unsafe address. */
export function replyHref(email: string | null, formName: string): string | null {
  if (!email || !isSafeEmail(email)) return null;
  const subject = clip(oneLine(`Re: ${formName}`), 200);
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

/** "Nora Fischer" → "Nora". Used for "Reply to Nora". */
export function firstName(name: string): string {
  return clip(oneLine(name).split(' ')[0] ?? '', FIRST_NAME_MAX);
}

/** Chronological number per response id: oldest is 1. `subs` is newest first. */
export function responseNumbers(subs: ReadonlyArray<StoredSubmission>): Map<string, number> {
  const numbers = new Map<string, number>();
  subs.forEach((s, i) => numbers.set(s.id, subs.length - i));
  return numbers;
}

/** Ids in `subs` that are unread, in `subs` order. */
export function unreadIds(
  subs: ReadonlyArray<StoredSubmission>,
  unread: ReadonlySet<string>,
): string[] {
  return subs.filter((s) => unread.has(s.id)).map((s) => s.id);
}

/* ---------- when ---------- */

/** Whole calendar days between two instants in local time (DST-safe). */
function calendarDaysBetween(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const b = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((a - b) / DAY_MS);
}

function localMidnight(d: Date, offsetDays = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays);
}

/** Day bucket for one timestamp — see `dayGroups`. */
export function dayGroupOf(iso: string, now: Date = new Date()): { key: string; label: string } {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { key: 'unknown', label: 'Earlier' };
  const diff = calendarDaysBetween(now, then);
  // Clock skew can put a response a moment in the future; call it today.
  if (diff <= 0) return { key: 'today', label: 'Today' };
  if (diff === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (diff < 7) return { key: 'week', label: 'Last 7 days' };
  if (then.getFullYear() === now.getFullYear() && then.getMonth() === now.getMonth()) {
    return { key: 'month', label: 'Earlier this month' };
  }
  const month = String(then.getMonth() + 1).padStart(2, '0');
  const label =
    then.getFullYear() === now.getFullYear()
      ? then.toLocaleDateString(undefined, { month: 'long' })
      : then.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return { key: `m-${then.getFullYear()}-${month}`, label };
}

/**
 * Group newest-first rows under `Today`, `Yesterday`, `Last 7 days`,
 * `Earlier this month`, then one group per month (`August`, or
 * `August 2025` outside the current year). Local time. Order is kept.
 */
export function dayGroups<T extends { receivedAt: string }>(
  subs: ReadonlyArray<T>,
  now: Date = new Date(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const byKey = new Map<string, DayGroup<T>>();
  for (const s of subs) {
    const { key, label } = dayGroupOf(s.receivedAt, now);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(s);
  }
  return groups;
}

/**
 * "Wed, Sep 23, 9:41 AM" in local time; the year is added outside this year.
 * Date and time are formatted apart and joined with a comma, because a
 * combined format reads "Sep 23 at 9:41 AM" in Safari and "Sep 23, 9:41 AM"
 * in Chrome.
 */
export function fullDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** 79_000 → [{1,'m'},{19,'s'}]. Null for a missing or non-positive duration. */
export function durationParts(ms: unknown): DurationPart[] | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return [{ value: s, unit: 's' }];
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem
      ? [
          { value: m, unit: 'm' },
          { value: rem, unit: 's' },
        ]
      : [{ value: m, unit: 'm' }];
  }
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem
    ? [
        { value: h, unit: 'h' },
        { value: rem, unit: 'm' },
      ]
    : [{ value: h, unit: 'h' }];
}

/** "1m 19s", or "—" when unknown. */
export function formatDuration(ms: unknown): string {
  const parts = durationParts(ms);
  return parts ? parts.map((p) => `${p.value}${p.unit}`).join(' ') : '—';
}

/* ---------- answers as text ---------- */

/** Display text for one answer; '' when blank. May span lines. */
export function answerText(q: Question, value: unknown): string {
  if (isBlankAnswer(value)) return '';
  const text = formatAnswerForQuestion(q, value);
  return text === '—' ? '' : text;
}

/** Single-line, clipped preview of one answer for list rows; '' when blank. */
export function answerPreview(sub: StoredSubmission, q: Question, max = 160): string {
  return clip(oneLine(answerText(q, sub.answers[q.id])), max);
}

/** Stored values as strings: `'x'` → `['x']`, `['a','b']` → same, `4` → `['4']`. */
export function answerValues(value: unknown): string[] {
  if (isBlankAnswer(value)) return [];
  if (Array.isArray(value)) {
    const out = value
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map((v) => String(v));
    return [...new Set(out)];
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  return [];
}

export function hasFiles(sub: StoredSubmission, questions: ReadonlyArray<Question>): boolean {
  return questions.some((q) => q.type === 'file_upload' && !isBlankAnswer(sub.answers[q.id]));
}

export function answerMatchesFilter(sub: StoredSubmission, filter: AnswerFilter): boolean {
  return answerValues(sub.answers[filter.questionId]).includes(filter.value);
}

/* ---------- search ---------- */

const haystacks = new WeakMap<
  StoredSubmission,
  { questions: ReadonlyArray<Question>; text: string }
>();

/** Lower-cased text of every answer (choice labels, not raw values). Cached per row. */
export function searchText(sub: StoredSubmission, questions: ReadonlyArray<Question>): string {
  const hit = haystacks.get(sub);
  if (hit && hit.questions === questions) return hit.text;
  const parts: string[] = [];
  for (const q of questions) {
    const text = answerText(q, sub.answers[q.id]);
    if (text) parts.push(text);
  }
  const text = parts.join('\n').toLowerCase();
  haystacks.set(sub, { questions, text });
  return text;
}

/**
 * Case-insensitive search over name, email and every answer. Words are
 * ANDed: "nora repair" matches a response containing both.
 */
export function matchesSearch(
  sub: StoredSubmission,
  questions: ReadonlyArray<Question>,
  query: string,
): boolean {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = searchText(sub, questions);
  return terms.every((t) => text.includes(t));
}

/* ---------- summary ---------- */

const OPTION_TYPES = new Set<Question['type']>([
  'single_choice',
  'multi_choice',
  'dropdown',
  'picture_choice',
]);
const COLUMN_CHOICE_TYPES = new Set<Question['type']>([...OPTION_TYPES, 'yes_no']);
const TEXT_COLUMN_FALLBACK = new Set<Question['type']>(['short_text', 'url', 'phone']);
/** More distinct values than this and a numeric chart only lists values that occur. */
const NUMERIC_DOMAIN_MAX = 11;

type ChoiceOption = { value: string; label: string };

function choiceOptions(q: Question): ChoiceOption[] | null {
  if (q.type === 'yes_no') {
    return [
      { value: 'yes', label: q.yesLabel ?? 'Yes' },
      { value: 'no', label: q.noLabel ?? 'No' },
    ];
  }
  if (q.type === 'legal') {
    return [
      { value: 'accept', label: q.acceptLabel ?? 'Accept' },
      { value: 'decline', label: q.declineLabel ?? 'Decline' },
    ];
  }
  if (OPTION_TYPES.has(q.type) && 'options' in q && Array.isArray(q.options)) {
    return q.options.map((o) => ({ value: String(o.value), label: o.label }));
  }
  return null;
}

/** Every value a numeric question can take, or null when open-ended / too many. */
function numericDomain(q: Question): number[] | null {
  let min: number | undefined;
  let max: number | undefined;
  let step = 1;
  if (q.type === 'nps') {
    min = 0;
    max = 10;
  } else if (q.type === 'scale' || q.type === 'number') {
    min = q.min;
    max = q.max;
    step = q.step && q.step > 0 ? q.step : 1;
  }
  if (min === undefined || max === undefined || !(max >= min)) return null;
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  if (count > NUMERIC_DOMAIN_MAX) return null;
  return Array.from({ length: count }, (_, i) => Number((min + i * step).toFixed(6)));
}

function isNumericQuestion(q: Question): boolean {
  return q.type === 'scale' || q.type === 'nps' || q.type === 'number';
}

/**
 * Questions worth a bar chart: option questions with options, yes/no,
 * scale, NPS, and numbers with a small bounded range (min/max, ≤11 values).
 * Legal consent is left out — it is almost always 100% "Accept".
 */
export function chartableQuestions(questions: ReadonlyArray<Question>): Question[] {
  return questions.filter((q) => {
    if (OPTION_TYPES.has(q.type)) return (choiceOptions(q)?.length ?? 0) > 0;
    if (q.type === 'yes_no' || q.type === 'scale' || q.type === 'nps') return true;
    if (q.type === 'number') return numericDomain(q) !== null;
    return false;
  });
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Answer counts for one question across `subs`. Choice questions: one row
 * per option (plus any stored value no longer in the options), sorted by
 * count, ties in option order. Scale / NPS / number: one row per value in
 * order, plus the average. `pct` is the share of people who answered, so
 * multi-choice rows can add up to more than 100.
 */
export function questionDistribution(
  question: Question,
  subs: ReadonlyArray<StoredSubmission>,
): Distribution {
  if (isNumericQuestion(question)) {
    const counts = new Map<number, number>();
    let answered = 0;
    let sum = 0;
    for (const s of subs) {
      const n = toNumber(s.answers[question.id]);
      if (n === null) continue;
      answered++;
      sum += n;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const domain = numericDomain(question);
    const values = new Set<number>(domain ?? []);
    counts.forEach((_, n) => values.add(n));
    const rows: DistributionRow[] = [...values]
      .sort((a, b) => a - b)
      .map((n) => {
        const count = counts.get(n) ?? 0;
        return {
          value: String(n),
          label: String(n),
          count,
          pct: answered ? Math.round((count / answered) * 100) : 0,
        };
      });
    return {
      questionId: question.id,
      kind: 'numeric',
      answered,
      rows,
      max: Math.max(1, ...rows.map((r) => r.count)),
      average: answered ? sum / answered : null,
    };
  }

  const options = choiceOptions(question) ?? [];
  const order = new Map(options.map((o, i) => [o.value, i]));
  const counts = new Map<string, number>();
  const extra: string[] = [];
  let answered = 0;
  for (const s of subs) {
    const vals = answerValues(s.answers[question.id]);
    if (vals.length === 0) continue;
    answered++;
    for (const v of vals) {
      if (!order.has(v) && !counts.has(v)) extra.push(v);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const all: Array<ChoiceOption & { i: number }> = [
    ...options.map((o, i) => ({ ...o, i })),
    ...extra.map((v, j) => ({ value: v, label: v, i: options.length + j })),
  ];
  const rows = all
    .map((o) => {
      const count = counts.get(o.value) ?? 0;
      return {
        row: {
          value: o.value,
          label: o.label,
          count,
          pct: answered ? Math.round((count / answered) * 100) : 0,
        },
        i: o.i,
      };
    })
    .sort((a, b) => b.row.count - a.row.count || a.i - b.i)
    .map((x) => x.row);
  return {
    questionId: question.id,
    kind: 'choice',
    answered,
    rows,
    max: Math.max(1, ...rows.map((r) => r.count)),
    average: null,
  };
}

/**
 * Headline numbers for the Summary. Weeks start Monday, local time. The
 * sparkline covers the last 14 days including today.
 */
export function kpis(
  subs: ReadonlyArray<StoredSubmission>,
  unread: ReadonlySet<string>,
  now: Date = new Date(),
): Kpis {
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  const weekStart = localMidnight(now, -dow);
  const lastWeekStart = localMidnight(now, -dow - 7);
  const sparkDays = Array.from({ length: 14 }, (_, i) => localMidnight(now, i - 13));
  const spark = new Array<number>(14).fill(0);
  const durations: number[] = [];
  let unreadCount = 0;
  let thisWeek = 0;
  let lastWeek = 0;

  for (const s of subs) {
    if (unread.has(s.id)) unreadCount++;
    const ms = s.meta?.durationMs;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) durations.push(ms);
    const t = Date.parse(s.receivedAt);
    if (!Number.isFinite(t)) continue;
    if (t >= weekStart.getTime()) thisWeek++;
    else if (t >= lastWeekStart.getTime()) lastWeek++;
    const ago = calendarDaysBetween(now, new Date(t));
    if (ago < 0) spark[13] = (spark[13] ?? 0) + 1;
    else if (ago < 14) spark[13 - ago] = (spark[13 - ago] ?? 0) + 1;
  }

  durations.sort((a, b) => a - b);
  const mid = durations.length >> 1;
  const medianMs =
    durations.length === 0
      ? null
      : durations.length % 2
        ? durations[mid]!
        : (durations[mid - 1]! + durations[mid]!) / 2;

  return {
    total: subs.length,
    unread: unreadCount,
    thisWeek,
    lastWeek,
    medianMs,
    spark,
    sparkDays,
    weekStart,
  };
}

/**
 * Columns for list rows: up to two choice questions, then the first long
 * text — or, without one, the first other text question that isn't the
 * respondent's name or email.
 */
export function tableColumns(questions: ReadonlyArray<Question>): TableColumns {
  const choices = questions.filter((q) => COLUMN_CHOICE_TYPES.has(q.type)).slice(0, 2);
  const name = nameQuestion(questions);
  const email = emailQuestion(questions);
  const text =
    questions.find((q) => q.type === 'long_text') ??
    questions.find((q) => TEXT_COLUMN_FALLBACK.has(q.type) && q !== name && q !== email) ??
    null;
  return { choices, text, all: text ? [...choices, text] : choices };
}
