/**
 * Answer piping — pure template resolver (ADR-014).
 *
 * Syntax (resolved in titles, subtitles, and body copy everywhere):
 *
 *   {{field:questionId}}   → the formatted answer for that question
 *   {{score}}              → the running score total (see scoring.ts)
 *   {{estimate}}           → the instant estimate, "$2,400 – $3,100" (ADR-064)
 *
 * Unknown / unanswered fields resolve to '' so copy degrades gracefully
 * ("Thanks, {{field:name}}!" → "Thanks, !"). Function-style `DynamicTitle`
 * keeps working — functions are resolved first, then their output is piped.
 */

import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import { formatDateAnswer, formatTime12 } from './dateValue.js';
import { formatAddress } from './address.js';
import { signaturePathOf, signatureTypedOf } from './signature.js';
import { formatPins } from './pins.js';
import { formatPhotoCount, formatVoiceNote } from './media.js';
import { signupPicks } from './signupAnswer.js';
import { describeFileUploadAnswers } from '@/utils/fileUploadRef.js';

const PIPE_RE = /\{\{\s*(score|estimate|field:[\w-]+)\s*\}\}/g;

/** Human-readable formatting for a piped answer value. */
export function formatAnswer(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(formatAnswer).join(', ');
  if (typeof File !== 'undefined' && v instanceof File) return v.name;
  if (typeof v === 'object') {
    // Matrix answers: "row: col" pairs.
    return Object.entries(v as Record<string, unknown>)
      .map(([row, col]) => `${row}: ${formatAnswer(col)}`)
      .join(', ');
  }
  return '';
}

/**
 * Formatting that knows the question (ADR-063): choice values read as their
 * labels (typed "Other" text as itself), yes/no and consent as their button
 * labels, dates in the question's format ("10/03/2026 – 10/07/2026"), and
 * numbers with their prefix/unit. Without a question it is `formatAnswer`.
 */
export function formatAnswerFor(q: Question | undefined, v: unknown): string {
  if (!q || v === undefined || v === null) return formatAnswer(v);
  switch (q.type) {
    case 'single_choice':
    case 'multi_choice':
    case 'dropdown':
    case 'picture_choice':
    case 'ranking': {
      const items = Array.isArray(v) ? v : [v];
      return items
        .map((item) =>
          typeof item === 'string'
            ? (q.options.find((o) => o.value === item)?.label ?? item)
            : formatAnswer(item),
        )
        .filter((t) => t !== '')
        .join(', ');
    }
    case 'yes_no':
      return v === 'yes'
        ? (q.yesLabel ?? 'Yes')
        : v === 'no'
          ? (q.noLabel ?? 'No')
          : formatAnswer(v);
    case 'legal':
      return v === 'accept'
        ? (q.acceptLabel ?? 'I accept')
        : v === 'decline'
          ? (q.declineLabel ?? "I don't accept")
          : formatAnswer(v);
    case 'date':
      return formatDateAnswer(v, q.format);
    case 'number':
      if (typeof v !== 'number') return formatAnswer(v);
      return `${q.prefix ?? ''}${v}${q.unit ? ` ${q.unit}` : ''}`;
    case 'contact_info': {
      if (typeof v !== 'object' || Array.isArray(v)) return formatAnswer(v);
      const c = v as Record<string, unknown>;
      return ['name', 'email', 'phone']
        .map((k) => c[k])
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map((x) => x.trim())
        .join(' · ');
    }
    case 'address':
      return formatAddress(v);
    case 'signature':
      return signatureTypedOf(v) ?? (signaturePathOf(v) ? 'Signed' : '');
    case 'image_pin':
      return formatPins(v);
    case 'voice_note':
      return formatVoiceNote(v);
    case 'location': {
      // In words, never the coordinates: "inside the service area" / a ZIP / a place.
      if (typeof v !== 'object' || Array.isArray(v)) return formatAnswer(v);
      const l = v as Record<string, unknown>;
      if (l.area === 'in') return 'inside the service area';
      if (l.area === 'out') return 'outside the service area';
      return typeof l.zip === 'string' ? l.zip : typeof l.typed === 'string' ? l.typed : '';
    }
    case 'photo_checklist':
      return formatPhotoCount(q, v);
    case 'availability': {
      // Compact on purpose (the engine budget), on a 12-hour clock:
      // "Mon 9:00 AM–11:30 AM, 2:00 PM–4:00 PM; Wed …". Responses and the
      // Review step read it in full with `formatAvailability`.
      if (typeof v !== 'object' || Array.isArray(v)) return formatAnswer(v);
      const a = v as Record<string, unknown>;
      return (q.days?.length ? q.days : Object.keys(a))
        .filter((d) => typeof a[d] === 'string' && a[d] !== '')
        .map(
          (d) =>
            `${d[0]!.toUpperCase()}${d.slice(1)} ${(a[d] as string)
              .replace(/,/g, ', ')
              .replace(/-/g, '–')
              // A day that runs to midnight ends at 24:00, which reads 12:00 AM.
              .replace(/\d\d:\d\d/g, (t) => formatTime12(t === '24:00' ? '00:00' : t))}`,
        )
        .join('; ');
    }
    case 'signup_slots': {
      // "Sat 10–11am, Sun 2–3pm (waitlist)" — a slot's label, else its day and
      // time as the date question reads them, "10/10/2026 9:00 AM" (ADR-066).
      const { slots, wait } = signupPicks(v);
      const name = (x: string) => {
        const s = q.slots.find((o) => o.value === x);
        return (
          s?.label?.trim() || formatDateAnswer([s?.date, s?.start].filter(Boolean).join('T')) || x
        );
      };
      return [...slots.map(name), ...wait.map((x) => `${name(x)} (waitlist)`)].join(', ');
    }
    case 'file_upload': {
      // File names, never the stored `slate-file://` refs (ADR-069); a file
      // saved on this device carries no name, so those read as "2 files".
      const t = describeFileUploadAnswers(v as string[]) ?? '';
      const n = Array.isArray(v) ? v.length : 1;
      return t.includes('Uploaded file') ? `${n} file${n > 1 ? 's' : ''}` : t;
    }
    default:
      return formatAnswer(v);
  }
}

/**
 * Resolve `{{field:id}}` and `{{score}}` placeholders in a template string.
 * Non-template strings pass through untouched (fast path). With `questions`,
 * answers read as labels and formatted dates (`formatAnswerFor`).
 */
export function pipe(
  template: string,
  answers: LooseAnswers,
  score = 0,
  questions?: ReadonlyArray<Question>,
  estimate = '',
): string {
  if (!template.includes('{{')) return template;
  return template.replace(PIPE_RE, (_match, token: string) => {
    if (token === 'score') return String(score);
    if (token === 'estimate') return estimate;
    const id = token.slice('field:'.length);
    const q = questions?.find((item) => item.id === id);
    // A contact block pipes as the name ("Thanks, Ada!"), else its first part (ADR-064).
    if (q?.type === 'contact_info') return formatAnswerFor(q, answers[id]).split(' · ')[0] ?? '';
    return formatAnswerFor(q, answers[id]);
  });
}

/**
 * Resolve all user-facing copy on a question — `title` (including
 * function-style `DynamicTitle`), `subtitle`, and `body` — into piped plain
 * strings. Field components downstream receive ready-to-render text.
 */
export function pipeQuestionCopy(
  q: Question,
  answers: LooseAnswers,
  score = 0,
  questions?: ReadonlyArray<Question>,
  estimate = '',
): Question {
  const out: Record<string, unknown> = { ...q };
  const title = (q as { title: string | ((a: LooseAnswers) => string) }).title;
  out.title = pipe(
    typeof title === 'function' ? title(answers) : title,
    answers,
    score,
    questions,
    estimate,
  );
  if ('subtitle' in q && typeof q.subtitle === 'string') {
    out.subtitle = pipe(q.subtitle, answers, score, questions, estimate);
  }
  if ('body' in q && typeof q.body === 'string') {
    out.body = pipe(q.body, answers, score, questions, estimate);
  }
  return out as unknown as Question;
}
