/**
 * How an answer reads on the Review step (ADR-069). Pure, no React.
 *
 * The Review step loads on demand, so it can carry fuller wording than the
 * piping formatter in the engine's core: a grid reads as its row and column
 * labels, a sign-up slot as its name or its day and 12-hour time, and
 * availability as 12-hour ranges. Everything else reads the way piping
 * reads it (`format`, the core's `formatAnswerFor`, passed in so this chunk
 * doesn't split the core). Never a stored code: a respondent should
 * recognise every line as what they answered.
 */

import type { Question } from '@/types/Question.js';
import { formatAvailability } from './availability.js';
import { signupPicks } from './signupAnswer.js';
import { slotName } from './signupView.js';

type Labelled = ReadonlyArray<{ value: string; label: string }>;

/** A grid answer: "Speed: Agree · Price: Disagree"; rows with no pick are left out. */
export function matrixText(rows: Labelled, columns: Labelled, v: unknown): string {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return '';
  const cells = v as Record<string, unknown>;
  return rows
    .map((row) => {
      const picked = ([] as unknown[])
        .concat(cells[row.value])
        .filter((c): c is string => typeof c === 'string' && c !== '')
        .map((c) => columns.find((o) => o.value === c)?.label ?? c);
      return picked.length ? `${row.label}: ${picked.join(', ')}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * A file's name from what a file question stores: a picked `File`, a cloud
 * ref (`slate-file://storage:public/<form>/<id>/<name>`) or a host's URL;
 * '' for a local ref, which carries no name. Spelled out here rather than
 * imported from utils/fileUploadRef.ts, so this chunk doesn't split a core
 * chunk in two (AGENTS.md).
 */
function fileName(x: unknown): string {
  if (typeof File !== 'undefined' && x instanceof File) return x.name;
  if (typeof x !== 'string') return '';
  const local = x.startsWith('slate-file://');
  if (local && !x.startsWith('slate-file://storage:')) return '';
  const last = x.split(/[?#]/)[0]!.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** "photo.jpg, notes.pdf"; "2 files" when any of them has no name to show. */
export function filesText(v: unknown): string {
  const names = (Array.isArray(v) ? v : [v]).map(fileName);
  if (names.length === 0) return '';
  if (names.every(Boolean)) return names.join(', ');
  return names.length === 1 ? '1 file' : `${names.length} files`;
}

/** The answer as the Review step shows it; '' when unanswered. */
export function reviewText(
  q: Question,
  v: unknown,
  format: (q: Question, v: unknown) => string,
): string {
  if (v === undefined || v === null) return '';
  switch (q.type) {
    case 'matrix':
      return matrixText(q.rows, q.columns, v);
    case 'signup_slots': {
      const { slots, wait } = signupPicks(v);
      const name = (value: string) =>
        slotName(
          (q.slots ?? []).find((s) => s.value === value),
          value,
        );
      return [...slots.map(name), ...wait.map((x) => `${name(x)} (waitlist)`)].join(', ');
    }
    case 'availability':
      return formatAvailability(q as unknown as Record<string, unknown>, v);
    case 'file_upload':
      return filesText(v);
    default:
      return format(q, v);
  }
}
