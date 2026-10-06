/**
 * Date answer strings (ADR-010, ADR-063). Pure, no React, no Intl — output is
 * the same on every device, which keeps exports and tests deterministic.
 *
 *   date only    YYYY-MM-DD
 *   with a time  YYYY-MM-DDTHH:MM        (24-hour wall clock, no time zone)
 *   range        start/end               (ISO 8601 interval: either form above)
 */

export type DatePart = { date: string; time?: string };
export type ParsedDateAnswer = { start: DatePart; end?: DatePart };

const PART_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * A 2-digit year, read with a sliding window: the year from 89 years ago to 10
 * years ahead that ends in those digits. In 2026, "26" is 2026, "36" is 2036,
 * "37" is 1937 and "99" is 1999, so birth years and near-future dates both work
 * (Caleb, 2026-10-05). Typed boxes and prefill links share it.
 */
export function expandYear(yy: string, now = new Date().getFullYear()): string {
  let y = now - (now % 100) + Number(yy);
  if (y > now + 10) y -= 100;
  else if (y < now - 89) y += 100;
  return String(y);
}

/** True iff `v` is a real calendar date in ISO `YYYY-MM-DD` form. */
export function isValidIsoDate(v: string): boolean {
  const m = ISO_DATE_RE.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/** True iff `v` is `HH:MM`, 00:00 to 23:59. */
export function isValidTime(v: string): boolean {
  const m = TIME_RE.exec(v);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function parsePart(raw: string): DatePart | null {
  const m = PART_RE.exec(raw);
  if (!m || !isValidIsoDate(m[1]!)) return null;
  if (m[2] !== undefined && !isValidTime(m[2])) return null;
  return m[2] !== undefined ? { date: m[1]!, time: m[2] } : { date: m[1]! };
}

/** Parse a stored date answer, or null when it isn't one. */
export function parseDateAnswer(v: unknown): ParsedDateAnswer | null {
  if (typeof v !== 'string' || v === '' || v.length > 40) return null;
  const slash = v.indexOf('/');
  if (slash === -1) {
    const start = parsePart(v);
    return start ? { start } : null;
  }
  const start = parsePart(v.slice(0, slash));
  const end = parsePart(v.slice(slash + 1));
  return start && end ? { start, end } : null;
}

// Writing an answer back (`dateAnswerToString`) lives with the date fields, in
// `dateEntry.ts`: only they need it, and this module ships in the core.

/** Sortable key for ordering two parts (date, then time; a missing time sorts first). */
export function partKey(p: DatePart): string {
  return `${p.date}T${p.time ?? '00:00'}`;
}

/** "14:05" → "2:05 PM". */
export function formatTime12(time: string): string {
  const m = TIME_RE.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

function formatPart(p: DatePart, format: 'MM/DD/YYYY' | 'DD/MM/YYYY'): string {
  const m = ISO_DATE_RE.exec(p.date);
  const date = m
    ? format === 'DD/MM/YYYY'
      ? `${m[3]}/${m[2]}/${m[1]}`
      : `${m[2]}/${m[3]}/${m[1]}`
    : p.date;
  if (!p.time) return date;
  // US dates read a 12-hour clock; day-first forms read 24-hour.
  return `${date} ${format === 'DD/MM/YYYY' ? p.time : formatTime12(p.time)}`;
}

/**
 * Human text for a stored date answer in the question's own format:
 * `10/03/2026`, `10/03/2026 2:30 PM`, `10/03/2026 – 10/07/2026`. Anything
 * that doesn't parse is returned unchanged.
 */
export function formatDateAnswer(
  v: unknown,
  format: 'MM/DD/YYYY' | 'DD/MM/YYYY' = 'MM/DD/YYYY',
): string {
  const parsed = parseDateAnswer(v);
  if (!parsed) return typeof v === 'string' ? v : '';
  const start = formatPart(parsed.start, format);
  return parsed.end ? `${start} – ${formatPart(parsed.end, format)}` : start;
}
