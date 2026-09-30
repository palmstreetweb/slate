/**
 * Close settings (ADR-063): is a form closed, and how to say so. Pure; the
 * server enforces the same rules (migration 019, submitresponse), this is
 * what the studio shows.
 */

import type { FormRecord } from './_formsStore.js';

export type CloseReason = 'date' | 'full';

/** Why a form is closed right now, or null while it takes responses. */
export function closedReason(
  form: Pick<FormRecord, 'closesAt' | 'maxResponses'> | null | undefined,
  liveResponses: number,
  now: number = Date.now(),
): CloseReason | null {
  if (!form) return null;
  if (form.closesAt) {
    const at = Date.parse(form.closesAt);
    if (Number.isFinite(at) && at <= now) return 'date';
  }
  if (typeof form.maxResponses === 'number' && liveResponses >= form.maxResponses) return 'full';
  return null;
}

/** Any close setting is on (scheduled or reached). */
export function hasCloseSettings(form: Pick<FormRecord, 'closesAt' | 'maxResponses'>): boolean {
  return Boolean(form.closesAt) || typeof form.maxResponses === 'number';
}

/** "Oct 5, 6:00 PM" in the viewer's time zone; the year only outside this year. */
export function formatCloseTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** One line for the Share panel and cards: "Open", "Closes Oct 5, 6:00 PM", "Closed · 20 of 20". */
export function describeClose(
  form: Pick<FormRecord, 'closesAt' | 'maxResponses'>,
  liveResponses: number,
  now: Date = new Date(),
): string {
  const reason = closedReason(form, liveResponses, now.getTime());
  if (reason === 'date') return `Closed ${formatCloseTime(form.closesAt!, now)}`;
  if (reason === 'full') return `Closed · ${form.maxResponses} of ${form.maxResponses} responses`;
  const parts: string[] = [];
  if (form.closesAt) parts.push(`closes ${formatCloseTime(form.closesAt, now)}`);
  if (typeof form.maxResponses === 'number') {
    parts.push(`${liveResponses} of ${form.maxResponses} responses`);
  }
  if (parts.length === 0) return 'Open';
  const line = parts.join(' · ');
  return `Open · ${line}`;
}

/** `<input type="datetime-local">` value (local wall clock) ↔ ISO instant. */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export const CLOSED_MESSAGE_MAX = 500;
export const MAX_RESPONSES_LIMIT = 10_000;
