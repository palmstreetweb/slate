/**
 * Pure helpers for the Responses admin view — human labels and type-aware
 * answer formatting. No React; unit-testable.
 */

import type { Question } from '@/index.js';
import { describeFileUploadAnswer, isFileUploadRef } from '@/index.js';
import { allowsOther, otherLabelOf } from '@/logic/other.js';
import { formatDateAnswer } from '@/logic/dateValue.js';
import { areaStatus, formatAddress, serviceAreaPrefixes } from '@/logic/address.js';
import { CONTACT_FIELDS } from '@/logic/contact.js';
import { signaturePathOf, signatureTypedOf } from '@/logic/signature.js';
import { pinsOf } from '@/logic/pins.js';
import { formZipAreas, locationAnswerCore as locationAnswer } from '@/logic/geo.js';
import { formatDistance, locationDistance } from '@/logic/geoText.js';
import {
  WEEKDAY_SHORT,
  availabilityGrid,
  clockLabel,
  decodeAvailability,
  formatAvailability,
} from '@/logic/availability.js';
import { formatVoiceNote, voiceAudioOf, voiceTypedOf } from '@/logic/media.js';
import { signupPicks } from '@/logic/signupAnswer.js';
import { slotName, slotWhenText } from '@/logic/signupView.js';
import { usPhoneText } from '@/logic/reviewText.js';
import { peekLocalUploadMeta } from './localFileStore.js';
import { TYPE_LABEL } from './questionTypeMeta.js';
import { safeText } from './answerShape.js';

const CONTACT_PRIORITY = new Set<Question['type']>(['short_text', 'email', 'phone', 'url']);

/**
 * A question as the owner reads it in Responses: its title, with piping shown
 * as "…" rather than "{{field:name}}" (one title serves every response), or
 * its type when the title is code ("Short Text") — never its internal id.
 */
function titleOf(q: Question): string {
  if (typeof q.title !== 'string') return TYPE_LABEL[q.type] ?? 'Question';
  return q.title.replace(/\{\{\s*(?:score|estimate|field:[\w-]+)\s*\}\}/g, '…');
}

function optionLabel(q: Question, value: string): string | null {
  if (!('options' in q) || !Array.isArray(q.options)) return null;
  return q.options.find((o) => o.value === value)?.label ?? null;
}

/** How an answer reads when its option was deleted and only the studio's code for it is left. */
export const REMOVED_OPTION = 'Removed option';

/** After a stored value the question no longer lists, when nobody typed it under Other. */
export const NO_LONGER_AN_OPTION = '(no longer an option)';

/**
 * A code the studio gave an option — `opt_` and six letters or digits
 * (formChecks.newOptionValue), or the `opt_1`, `opt_2`… it gave them before —
 * that the question no longer lists: an option deleted after someone picked
 * it. Nobody types one under Other, and it means nothing to the owner.
 */
export function isRemovedOptionValue(value: string): boolean {
  return /^opt_(\d+|[a-z0-9]{6})$/.test(value);
}

/**
 * A choice value as the owner reads it: the option's label; "Removed option"
 * for the studio's code of an option deleted since; on a question that allows
 * Other (ADR-063), "Other: what they typed"; otherwise the stored text marked
 * "(no longer an option)" — Other turned off since, or a readable option
 * deleted. Typed words are never hidden (review fixes, ADR-069): the reader,
 * search, the CSV and the Summary all read this.
 */
export function choiceText(q: Question, value: string): string {
  const label = optionLabel(q, value);
  if (label !== null) return label;
  if (isRemovedOptionValue(value)) return REMOVED_OPTION;
  return allowsOther(q) ? `${otherLabelOf(q)}: ${value}` : `${value} ${NO_LONGER_AN_OPTION}`;
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
    case 'multi_choice':
      if (typeof value === 'string') return choiceText(question, value);
      if (Array.isArray(value)) {
        return value
          .map((v) => (typeof v === 'string' ? choiceText(question, v) : safeText(v)))
          .join(', ');
      }
      return safeText(value);

    case 'date':
      // In the form's own format ("10/12/2026"), as the respondent saw it (copy
      // QA); the CSV keeps plain dates ISO so a sheet sorts them.
      if (typeof value === 'string') return formatDateAnswer(value, question.format) || value;
      return safeText(value);

    case 'phone':
      // As typed, "(805) 555-0100", never the stored "+18055550100" (copy QA).
      return typeof value === 'string' ? usPhoneText(value) : safeText(value);

    case 'number':
      if (typeof value === 'number' && (question.prefix || question.unit)) {
        return `${question.prefix ?? ''}${value}${question.unit ? ` ${question.unit}` : ''}`;
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
        return (
          Object.entries(value as Record<string, unknown>)
            // A row ticked and then unticked stays in the answer, empty: leave it out (copy QA).
            .filter(
              ([, col]) => !(col === '' || col == null || (Array.isArray(col) && !col.length)),
            )
            .map(([rowVal, col]) => {
              const rowLabel =
                question.rows.find((r) => r.value === rowVal)?.label ?? safeText(rowVal);
              // Several per row: every column picked, not only the first.
              const colLabel = (Array.isArray(col) ? col : [col])
                .map((colVal) =>
                  typeof colVal === 'string' && 'columns' in question
                    ? (question.columns.find((c) => c.value === colVal)?.label ?? safeText(colVal))
                    : safeText(colVal),
                )
                .join(', ');
              return `${rowLabel}: ${colLabel}`;
            })
            .join('\n')
        );
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

    case 'contact_info': {
      // One part per line: "Ada Lovelace\nada@example.com\n+18055550100".
      if (typeof value !== 'object' || Array.isArray(value)) return safeText(value);
      const parts = CONTACT_FIELDS.map((f) => (value as Record<string, unknown>)[f])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => usPhoneText(v.trim()));
      return parts.length ? parts.join('\n') : '—';
    }

    case 'address': {
      const line = formatAddress(value);
      if (!line) return typeof value === 'object' ? '—' : safeText(value);
      const status = areaStatus(value, serviceAreaPrefixes(question.serviceArea));
      return status === 'out' ? `${line} (outside service area)` : line;
    }

    case 'signature': {
      const typed = signatureTypedOf(value);
      if (typed) return `Typed: ${typed}`;
      if (signaturePathOf(value)) return 'Signed';
      return safeText(value) || '—';
    }

    // Wave C (ADR-065)
    case 'image_pin': {
      const pins = pinsOf(value);
      if (!pins.length) return typeof value === 'object' ? '—' : safeText(value);
      return pins
        .map((p, i) => `Pin ${i + 1}${p.note.trim() ? `: ${p.note.trim()}` : ''}`)
        .join('\n');
    }

    case 'voice_note':
      return formatVoiceNote(value) || (typeof value === 'object' ? '—' : safeText(value));

    case 'location':
      return locationText(question, value);

    case 'photo_checklist': {
      if (typeof value !== 'object' || Array.isArray(value)) return safeText(value);
      const a = value as Record<string, unknown>;
      const lines = question.items
        .filter((i) => typeof a[i.value] === 'string' && a[i.value] !== '')
        .map((i) => `${i.label}: photo`);
      return lines.length
        ? `${lines.length} of ${question.items.length} photos\n${lines.join('\n')}`
        : '—';
    }

    case 'availability':
      return (
        formatAvailability(question as unknown as Record<string, unknown>, value) ||
        (typeof value === 'object' ? '—' : safeText(value))
      );

    // Wave D (ADR-066): one slot per line, with when it is; waitlists marked.
    case 'signup_slots': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return safeText(value);
      const { slots, wait } = signupPicks(value);
      const lines = [
        ...slots.map((v) => slotLine(question, v)),
        ...wait.map((v) => `Waitlist: ${slotLine(question, v)}`),
      ];
      return lines.length ? lines.join('\n') : '—';
    }

    default:
      return safeText(value);
  }
}

/**
 * A slot as the owner reads it: "Morning swim (Sat, Oct 3 · 10–11 AM)". A key
 * the question no longer offers (a removed slot) reads "Removed slot (key)".
 */
export function slotLine(
  question: Extract<Question, { type: 'signup_slots' }>,
  value: string,
): string {
  const slot = question.slots?.find((s) => s.value === value);
  if (!slot) return `Removed slot (${value})`;
  const when = slot.label?.trim() ? slotWhenText(slot) : '';
  return when ? `${slotName(slot)} (${when})` : slotName(slot);
}

/**
 * How a location was given: their device's location, a ZIP code or a typed
 * place — from a kept answer's shape or a verdict-only answer's `via` (ADR-068).
 */
export function locationViaOf(value: unknown): 'gps' | 'zip' | 'typed' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.lat === 'string' && typeof v.lng === 'string') return 'gps';
  if (typeof v.zip === 'string') return 'zip';
  if (typeof v.typed === 'string') return 'typed';
  return v.via === 'gps' || v.via === 'zip' || v.via === 'typed' ? v.via : null;
}

/** True for a stored location that is only a verdict (the default, ADR-068). */
export function isVerdictOnlyLocation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.via === 'string' && !('lat' in v) && !('zip' in v) && !('typed' in v);
}

const VIA_TEXT = { gps: 'Their location', zip: 'A ZIP code', typed: 'A typed place' } as const;

/** A location in words: in / out of the area and how far, a ZIP, or a typed place (ADR-065). */
export function locationText(
  question: Extract<Question, { type: 'location' }>,
  value: unknown,
  form: ReadonlyArray<Question> = [],
): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return safeText(value) || '—';
  const v = value as Record<string, unknown>;
  const area = locationAreaOf(question, value, form);
  const areaText =
    area === 'in' ? 'Inside the service area' : area === 'out' ? 'Outside the service area' : '';
  if (typeof v.lat === 'string' && typeof v.lng === 'string') {
    const d = locationDistance(question as unknown as Record<string, unknown>, value);
    const far = d !== null ? `${formatDistance(d, question.radiusUnit)} away` : '';
    return [areaText, far, `${v.lat}, ${v.lng}`].filter(Boolean).join(' · ');
  }
  if (typeof v.zip === 'string') return [`ZIP ${v.zip}`, areaText].filter(Boolean).join(' · ');
  if (typeof v.typed === 'string') return `Typed: ${v.typed}`;
  // Verdict only (ADR-068): the area, and how it was checked; the place itself wasn't kept.
  const via = locationViaOf(value);
  if (via === 'gps') {
    return areaText
      ? `${areaText} · checked with their location`
      : 'Shared their location · not checked';
  }
  if (via === 'zip') {
    return areaText ? `${areaText} · checked with a ZIP code` : 'Typed a ZIP code · not checked';
  }
  if (via === 'typed') return 'Typed a place · not checked';
  return areaText || '—';
}

/**
 * In / out of the area for a stored location: the server's verdict as stored
 * (it recomputed it from the published form, ADR-065), else recomputed here
 * from today's settings for rows the engine stored itself (test runs, local).
 */
export function locationAreaOf(
  question: Extract<Question, { type: 'location' }>,
  value: unknown,
  form: ReadonlyArray<Question> = [],
): 'in' | 'out' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stored = (value as Record<string, unknown>).area;
  if (stored === 'in' || stored === 'out') return stored;
  const area = locationAnswer(
    question as unknown as Record<string, unknown>,
    value,
    formZipAreas(form),
  )?.area;
  return area === 'in' || area === 'out' ? area : null;
}

/**
 * Spreadsheet columns for an answer made of parts (ADR-064): a contact block
 * becomes Name / Email / Phone, an address Street / Unit / City / State / ZIP
 * (/ Country, / In service area). Wave C (ADR-065): a location becomes
 * In service area / Answered with (and, when kept — ADR-068 — Latitude /
 * Longitude / ZIP or place / Distance; `subs` tells whether any is), a photo
 * checklist one column per shot, availability one column per day. Wave D
 * (ADR-066): sign-up slots become Slot (and Waitlist). Null for
 * one-column answers.
 */
export function csvParts(
  question: Question,
  subs?: ReadonlyArray<{ answers?: Record<string, unknown> }>,
): Array<{ key: string; label: string; cell: (value: unknown) => string }> | null {
  const part = (value: unknown, key: string): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const v = (value as Record<string, unknown>)[key];
    return typeof v === 'string' ? v.trim() : '';
  };
  if (question.type === 'contact_info') {
    return [
      { key: 'name', label: 'Name', cell: (v) => part(v, 'name') },
      { key: 'email', label: 'Email', cell: (v) => part(v, 'email') },
      { key: 'phone', label: 'Phone', cell: (v) => part(v, 'phone') },
    ];
  }
  if (question.type === 'address') {
    const us = (question.format ?? 'us') === 'us';
    const cols: Array<{ key: string; label: string; cell: (value: unknown) => string }> = [
      { key: 'street', label: 'Street', cell: (v) => part(v, 'street') },
      { key: 'line2', label: 'Unit', cell: (v) => part(v, 'line2') },
      { key: 'city', label: 'City', cell: (v) => part(v, 'city') },
      { key: 'region', label: us ? 'State' : 'Region', cell: (v) => part(v, 'region') },
      { key: 'postal', label: us ? 'ZIP' : 'Postal code', cell: (v) => part(v, 'postal') },
    ];
    if (question.country)
      cols.push({ key: 'country', label: 'Country', cell: (v) => part(v, 'country') });
    const area = serviceAreaPrefixes(question.serviceArea);
    if (area.length) {
      cols.push({
        key: 'area',
        label: 'In service area',
        cell: (v) => {
          const status = areaStatus(v, area);
          return status === 'in' ? 'Yes' : status === 'out' ? 'No' : '';
        },
      });
    }
    return cols;
  }
  // Wave C (ADR-065). By default only the verdict is stored (ADR-068): In service area and
  // what they answered with. Latitude / Longitude / ZIP or place / Distance join when the owner
  // keeps the approximate location, or when any response being exported still has one.
  if (question.type === 'location') {
    const unit = question.radiusUnit === 'km' ? 'km' : 'mi';
    const cols: Array<{ key: string; label: string; cell: (value: unknown) => string }> = [
      {
        key: 'area',
        label: 'In service area',
        cell: (v) => {
          const a = locationAreaOf(question, v);
          return a === 'in' ? 'Yes' : a === 'out' ? 'No' : '';
        },
      },
      {
        key: 'via',
        label: 'Answered with',
        cell: (v) => {
          const via = locationViaOf(v);
          return via ? VIA_TEXT[via] : '';
        },
      },
    ];
    const kept =
      question.keepLocation === true ||
      Boolean(
        subs?.some((s) => {
          const v = s.answers?.[question.id];
          return locationViaOf(v) !== null && !isVerdictOnlyLocation(v);
        }),
      );
    if (!kept) return cols;
    return [
      ...cols,
      { key: 'lat', label: 'Latitude', cell: (v) => part(v, 'lat') },
      { key: 'lng', label: 'Longitude', cell: (v) => part(v, 'lng') },
      {
        key: 'place',
        label: 'ZIP or place',
        cell: (v) => part(v, 'zip') || part(v, 'typed'),
      },
      {
        key: 'distance',
        label: `Distance (${unit})`,
        cell: (v) => {
          const d = locationDistance(question as unknown as Record<string, unknown>, v);
          return d === null ? '' : String(Math.round(d * 10) / 10);
        },
      },
    ];
  }
  if (question.type === 'photo_checklist') {
    return question.items.map((item) => ({
      key: `photo:${item.value}`,
      label: item.label,
      cell: (v: unknown) => {
        const ref = part(v, item.value);
        return ref ? (describeFileUploadAnswer(ref, peekLocalUploadMeta(ref)) ?? 'Photo') : '';
      },
    }));
  }
  // Wave D (ADR-066): the slots taken, and — with a waitlist — the waitlists joined.
  if (question.type === 'signup_slots') {
    const cols = [
      {
        key: 'slot',
        label: 'Slot',
        cell: (v: unknown) =>
          signupPicks(v)
            .slots.map((x) => slotLine(question, x))
            .join('; '),
      },
    ];
    if (question.waitlist) {
      cols.push({
        key: 'wait',
        label: 'Waitlist',
        cell: (v: unknown) =>
          signupPicks(v)
            .wait.map((x) => slotLine(question, x))
            .join('; '),
      });
    }
    return cols;
  }
  if (question.type === 'availability') {
    const grid = availabilityGrid(question as unknown as Record<string, unknown>);
    return grid.days.map((day) => ({
      key: `day:${day}`,
      label: WEEKDAY_SHORT[day] ?? day,
      cell: (v: unknown) => {
        const set = decodeAvailability(grid, v).get(day);
        if (!set) return '';
        const out: string[] = [];
        let i = 0;
        while (i < grid.count) {
          if (!set.has(i)) {
            i += 1;
            continue;
          }
          let j = i;
          while (j < grid.count && set.has(j)) j += 1;
          out.push(
            `${clockLabel(grid.start + i * grid.slot)}–${clockLabel(grid.start + j * grid.slot)}`,
          );
          i = j;
        }
        return out.join(', ');
      },
    }));
  }
  return null;
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
    if (q.type === 'contact_info') return 11;
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
  // Numbers stay numbers in a spreadsheet: no prefix or unit (ADR-063).
  if (question.type === 'number' && typeof value === 'number') return String(value);
  // The drawing itself stays in the app; the sheet says it was signed (ADR-064).
  if (question.type === 'signature') {
    const typed = signatureTypedOf(value);
    return typed ? `Typed: ${typed}` : signaturePathOf(value) ? 'Signed (drawn)' : '';
  }
  // Pins with where they are, so a sheet can be read without the photo (ADR-065).
  if (question.type === 'image_pin') {
    return pinsOf(value)
      .map(
        (p, i) =>
          `Pin ${i + 1} at ${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down${
            p.note.trim() ? `: ${p.note.trim()}` : ''
          }`,
      )
      .join('; ');
  }
  // The recording stays in the app; the sheet names it (ADR-065).
  if (question.type === 'voice_note') {
    const typed = voiceTypedOf(value);
    if (typed) return `Typed: ${typed}`;
    const ref = voiceAudioOf(value);
    if (!ref) return '';
    const name = describeFileUploadAnswer(ref, peekLocalUploadMeta(ref));
    return `${formatVoiceNote(value)}${name ? `: ${name}` : ''}`;
  }
  // A plain date stays ISO in a sheet, which sorts it (the reader shows the form's format).
  if (question.type === 'date' && typeof value === 'string' && value.length === 10) return value;
  // A phone stays as stored, "+18055550100", as it always exported: CRMs and diallers read
  // it, and the contact block's Phone column is the same (the reader shows it as written).
  if (question.type === 'phone' && typeof value === 'string') return value;
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
