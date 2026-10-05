/**
 * Typing a date into the segmented boxes (ADR-010, ADR-063): the plain date
 * and the date with a time or a range share these rules. Pure, no React.
 *
 * On demand only: the date fields load with their chunks, so nothing the
 * engine's core imports may import this (a core module's exports all ship up
 * front, AGENTS.md). Stored-answer parsing stays in `dateValue.ts`, unchanged.
 *
 *   - A 2-digit year means this century: "26" is 2026 (Caleb, QA pass).
 *   - Years before 1900 are refused in plain words.
 *   - "/", "-" or "." after one digit finishes that box ("3/" is 03).
 *   - A whole date pasted or typed into one box fills all three.
 */

import type { DatePart, ParsedDateAnswer } from './dateValue.js';
import { isValidIsoDate } from './dateValue.js';

export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY';
export type DateBoxes = { month: string; day: string; year: string };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function partToString(p: DatePart): string {
  return p.time ? `${p.date}T${p.time}` : p.date;
}

export function dateAnswerToString(a: ParsedDateAnswer): string {
  return a.end ? `${partToString(a.start)}/${partToString(a.end)}` : partToString(a.start);
}

/** "26" → "2026"; anything else as typed. */
export function fullYear(year: string): string {
  return year.length === 2 ? `20${year}` : year;
}

/**
 * The ISO date the boxes hold, or what to fix, in plain words. `which` names
 * the date in messages ("date", "start date", "end date").
 */
export function buildIsoDate(
  b: DateBoxes,
  format: DateFormat,
  which = 'date',
): { date: string } | { error: string } {
  if (!b.month || !b.day || !b.year) return { error: `Please finish the ${which} (${format})` };
  const year = fullYear(b.year);
  if (year.length !== 4) return { error: 'Please use a 4-digit year, like 2026' };
  if (Number(year) < 1900) return { error: 'Please check the year. It should be 1900 or later.' };
  const month = Number(b.month);
  if (month < 1 || month > 12) return { error: 'Please check the month. It should be 1 to 12.' };
  const date = `${year}-${b.month.padStart(2, '0')}-${b.day.padStart(2, '0')}`;
  if (!isValidIsoDate(date)) {
    const days = new Date(Number(year), month, 0).getDate();
    return Number(b.day) < 1
      ? { error: 'Please check the day.' }
      : { error: `${MONTHS[month - 1]} ${year} has only ${days} days. Please check the day.` };
  }
  return { date };
}

/** The order the boxes appear in. */
export function boxOrder(format: DateFormat): Array<keyof DateBoxes> {
  return format === 'DD/MM/YYYY' ? ['day', 'month', 'year'] : ['month', 'day', 'year'];
}

/**
 * A whole date in one box ("10/03/2026", "3-7-26", "2026-10-03"): the three
 * boxes it fills, in the form's order (a 4-digit first group is a year first).
 * Null when it isn't three groups of digits.
 */
export function splitTypedDate(raw: string, format: DateFormat): DateBoxes | null {
  let g = raw.match(/\d+/g);
  // Eight digits with no separators ("10032026") read as the form's order.
  if (g?.length === 1 && g[0]!.length === 8) g = [g[0]!.slice(0, 2), g[0]!.slice(2, 4), g[0]!.slice(4)];
  if (!g || g.length !== 3 || g.some((x) => x.length > 4)) return null;
  if (g[0]!.length === 4) return { year: g[0]!, month: g[1]!.slice(0, 2), day: g[2]!.slice(0, 2) };
  const [first, second] = boxOrder(format);
  return {
    [first!]: g[0]!.slice(0, 2),
    [second!]: g[1]!.slice(0, 2),
    year: g[2]!.slice(0, 4),
  } as DateBoxes;
}

/**
 * What one box keeps from what was typed into it, and whether focus moves on:
 * at full length, after a separator ("3/" → "03", "9:" → "09"), or on a digit
 * that can't start a two-digit value (a month of 2–9, a day of 4–9, an hour
 * above `hourLead`, minutes of 6–9).
 */
export function typedBox(
  box: 'month' | 'day' | 'year' | 'hour' | 'minute',
  raw: string,
  hourLead = 2,
): { digits: string; done: boolean } {
  const maxLen = box === 'year' ? 4 : 2;
  let digits = raw.replace(/\D/g, '').slice(0, maxLen);
  if (digits.length === 1 && maxLen === 2 && /\d\D+$/.test(raw)) digits = `0${digits}`;
  const n = Number(digits);
  const done =
    digits.length === maxLen ||
    (digits.length === 1 &&
      ((box === 'month' && n > 1) ||
        (box === 'day' && n > 3) ||
        (box === 'hour' && n > hourLead) ||
        (box === 'minute' && n > 5)));
  return { digits, done: digits.length > 0 && done };
}
