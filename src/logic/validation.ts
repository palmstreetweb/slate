/**
 * Per-question-type validators. Pure functions, no side effects.
 *
 * Inline validation happens on submit-attempt only (no live red borders as
 * the user types — per brief §10.4). The returned `ValidationError` is null
 * when the answer passes; otherwise it carries a stable `code` and a
 * human-readable `message`.
 */

import type { DateQuestion, Question } from '@/types/Question.js';
import { isScaleStepValue } from '@/utils/scaleStep.js';
import { formatDateAnswer, isValidIsoDate, parseDateAnswer, partKey } from './dateValue.js';
import { addressErrors, contactErrors } from './contact.js';
import {
  SIG_TYPED_MAX,
  isRealSignature,
  parseSignaturePath,
  signaturePathOf,
} from './signature.js';
import { PIN_NOTE_MAX, parsePin, pinLimit } from './pins.js';
import { locationAnswerCore } from './geo.js';
import {
  VOICE_TYPED_MAX,
  photosTaken,
  voiceAudioOf,
  voiceMaxSeconds,
  voiceSecondsOf,
} from './media.js';
import { signupPicks } from './signupAnswer.js';

export { isValidIsoDate };

export type ValidationError = { code: string; message: string };

export type ValidationResult = ValidationError | null;

/** RFC-lite email regex per brief §5. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Availability ranges (ADR-065): `HH:MM-HH:MM`, comma separated. */
const RANGES_RE = /^\d{2}:\d{2}-\d{2}:\d{2}(,\d{2}:\d{2}-\d{2}:\d{2})*$/;

/**
 * Loose website check — scheme optional, needs a host with a dot (any
 * alphabet) or an IPv4 address, then an optional port and a path, query
 * or fragment ("instagram.com?igsh=…", "example.com#top"; audit 2026-10).
 */
const URL_RE =
  /^(https?:\/\/)?(([\p{L}\p{N}-]+\.)+\p{L}{2,}|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]\S*)?$/iu;

/**
 * The longest text a short or long text answer takes: the question's own
 * limit when it is 1 or more, in whole characters (a 0 or negative one would
 * trap everyone, so it counts as unset; 2.5 is 2), else what the server keeps
 * (10,000 characters).
 */
export function textMax(q: { maxLength?: number }): number {
  return (q.maxLength ?? 0) >= 1 ? Math.floor(q.maxLength!) : 1e4;
}

/** Characters as people count them: an emoji is one, not two. */
export const charCount = (s: string): number => [...s].length;

/** "1,000,000", "0.25": numbers in messages read as people write them. */
const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 20 });

/**
 * "Enter a number from $10 to $500", in the question's own prefix and unit.
 * The owner's unit is a plural, so it follows any bound but 1: "Enter 2
 * guests or more", "Enter 1 or more", never "Enter 1 guests" (COPY-R15).
 * Bounds set the wrong way round are ignored, so a live form never asks for
 * a number nobody can give.
 */
function rangeError(
  n: number,
  min = -Infinity,
  max = Infinity,
  prefix = '',
  unit = '',
): ValidationError | null {
  if (min > max || (n >= min && n <= max)) return null;
  const at = (b: number) => prefix + num(b) + (unit && Math.abs(b) !== 1 ? ' ' + unit : '');
  return {
    code: n < min ? 'min' : 'max',
    message:
      max === Infinity
        ? `Enter ${at(min)} or more`
        : min === -Infinity
          ? `Enter ${at(max)} or less`
          : min === max
            ? `Enter ${at(min)}`
            : `Enter a number from ${prefix + num(min)} to ${at(max)}`,
  };
}

/**
 * Date answers (ADR-010, ADR-063): the shape must match the question — a time
 * when `includeTime`, a `start/end` pair when `range` — every date sits inside
 * `min`/`max`, and a range never ends before it starts. Limits read in the
 * question's own format; limits set the wrong way round are ignored.
 */
function validateDate(question: DateQuestion, answer: unknown): ValidationError | null {
  if (typeof answer !== 'string' || answer.length === 0) return null;
  const parsed = parseDateAnswer(answer);
  const parts = parsed ? (parsed.end ? [parsed.start, parsed.end] : [parsed.start]) : [];
  const shapeOk =
    parsed !== null &&
    Boolean(parsed.end) === Boolean(question.range) &&
    parts.every((p) => Boolean(p.time) === Boolean(question.includeTime));
  if (!shapeOk) {
    return { code: 'date', message: "That doesn't look like a valid date" };
  }
  const { min, max, format } = question;
  for (const p of parts) {
    if (min && max && min > max) break;
    if (min && p.date < min) {
      return { code: 'min', message: `Pick a date on or after ${formatDateAnswer(min, format)}` };
    }
    if (max && p.date > max) {
      return { code: 'max', message: `Pick a date on or before ${formatDateAnswer(max, format)}` };
    }
  }
  if (parsed!.end && partKey(parsed!.end) < partKey(parsed!.start)) {
    return { code: 'range_order', message: 'The end can’t be before the start' };
  }
  return null;
}

/** The first message from a per-part check, as a ValidationError. */
function firstPartError(errors: Record<string, string | undefined>): ValidationError | null {
  for (const [part, message] of Object.entries(errors)) {
    if (message) return { code: part, message };
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isBlankString(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === '';
}

function isMissingValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export type PickRule = {
  options: ReadonlyArray<{ value: unknown }>;
  allowOther?: boolean;
  min?: number;
  max?: number;
};

/** The choices on offer: options with different values (two with one value tick as one), and Other. */
export const pickChoices = (q: PickRule): number =>
  new Set(q.options.map((o) => o.value)).size + (q.allowOther ? 1 : 0);

/**
 * The picks a multi choice (or a picture choice with `multiple`) asks for, as
 * `[min, max]`, never more than a respondent can give: the minimum is a whole
 * number and at most the choices on offer (Other counts as one), and a maximum
 * below 1 or below that minimum is dropped (Infinity: no maximum). The studio
 * keeps owners from saving such limits; this keeps forms saved before that
 * answerable. The server's clamp counts choices the same way (CH-05).
 */
export function pickLimits(q: PickRule): [number, number] {
  const min = Math.min(Math.ceil(q.min ?? 0), pickChoices(q));
  return [min, q.max! >= Math.max(min, 1) ? Math.floor(q.max!) : Infinity];
}

/** `prev` with `value` ticked or unticked; a pick past the maximum is refused (same list back). */
export function togglePick(q: PickRule, prev: unknown, value: string): string[] {
  const cur = Array.isArray(prev) ? (prev as string[]) : [];
  return cur.includes(value)
    ? cur.filter((v) => v !== value)
    : cur.length < pickLimits(q)[1]
      ? [...cur, value]
      : cur;
}

export function validate(question: Question, answer: unknown): ValidationResult {
  switch (question.type) {
    case 'welcome':
    case 'statement':
    case 'review':
    case 'thanks':
      return null;

    case 'short_text':
    case 'long_text': {
      if (question.required && isBlankString(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'string') {
        const max = textMax(question);
        if (charCount(answer) > max) {
          return {
            code: 'too_long',
            message: `Keep it to ${num(max)} character${max === 1 ? '' : 's'} or fewer`,
          };
        }
        // A pattern from JSON (a link, a stored form) is a string or {}, not a
        // RegExp: it can't be tested, so it's ignored rather than throwing (NEW-01).
        const re = question.type === 'short_text' ? question.pattern : undefined;
        if (answer && typeof re?.test == 'function' && !re.test(answer)) {
          return {
            code: 'pattern',
            message:
              (question as { patternError?: string }).patternError ?? 'Please check the format',
          };
        }
      }
      return null;
    }

    case 'email': {
      if (question.required && isBlankString(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'string' && answer.length > 0 && !EMAIL_RE.test(answer)) {
        return { code: 'email', message: "That doesn't look like a valid email" };
      }
      return null;
    }

    case 'phone': {
      if (question.required && isBlankString(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      // PhoneField performs libphonenumber-js parsing and surfaces format
      // errors before the engine asks the validator. Engine-level check
      // is presence only.
      return null;
    }

    case 'url': {
      if (question.required && isBlankString(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'string' && answer.trim().length > 0 && !URL_RE.test(answer.trim())) {
        return { code: 'url', message: "That doesn't look like a valid website" };
      }
      return null;
    }

    case 'date': {
      if (question.required && isBlankString(answer)) {
        return {
          code: 'required',
          message: question.range
            ? 'Please pick both dates'
            : question.includeTime
              ? 'Please pick a date and time'
              : 'Please pick a date',
        };
      }
      return validateDate(question, answer);
    }

    case 'number': {
      if (question.required && isMissingValue(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'number') {
        if (!Number.isFinite(answer)) return { code: 'number', message: 'Please enter a number' };
        return rangeError(answer, question.min, question.max, question.prefix, question.unit);
      }
      return null;
    }

    case 'scale': {
      const required = question.required ?? false;
      if (required && (answer === undefined || answer === null)) {
        return { code: 'required', message: 'Please pick a number' };
      }
      if (typeof answer === 'number') {
        // The field draws a scale set the wrong way round in order, so check it that way too.
        const lo = Math.min(question.min, question.max);
        const hi = Math.max(question.min, question.max);
        const step = question.step ?? 1;
        return (
          rangeError(answer, lo, hi) ??
          (isScaleStepValue(answer, lo, hi, step)
            ? null
            : { code: 'step', message: `Pick a number in steps of ${step}` })
        );
      }
      return null;
    }

    case 'file_upload': {
      const isFileItem = (v: unknown): boolean =>
        (typeof File !== 'undefined' && v instanceof File) ||
        (typeof v === 'string' && v.trim() !== '');

      // Default ON when unset (ADR-032) — set `multiple: false` for single-file.
      if (question.multiple !== false) {
        const arr = Array.isArray(answer) ? answer : isFileItem(answer) ? [answer] : [];
        // Below 1 is the usual 10, as the field and the server read it (ENG-02).
        const maxFiles = question.maxFiles! >= 1 ? Math.floor(question.maxFiles!) : 10;
        if (question.required && arr.length === 0) {
          return { code: 'required', message: 'Please choose at least one file' };
        }
        if (arr.length > maxFiles) {
          return {
            code: 'max_selections',
            message: `Attach at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}`,
          };
        }
        if (arr.some((item) => !isFileItem(item))) {
          return { code: 'required', message: 'Please choose a file' };
        }
        return null;
      }

      if (question.required) {
        if (!isFileItem(answer)) {
          return { code: 'required', message: 'Please choose a file' };
        }
      }
      return null;
    }

    case 'picture_choice':
    case 'multi_choice': {
      // A picture choice without `multiple` is one pick, like a single choice.
      if (question.type === 'picture_choice' && !question.multiple) {
        return (question.required ?? true) && isBlankString(answer)
          ? { code: 'required', message: 'Please pick one' }
          : null;
      }
      const picks = Array.isArray(answer) ? answer.length : 0;
      const [min, max] = pickLimits(question);
      if (picks < min) {
        return {
          code: 'min_selections',
          message: min === 1 ? 'Please pick at least one' : `Pick at least ${min}`,
        };
      }
      return picks > max ? { code: 'max_selections', message: `Pick up to ${max}` } : null;
    }

    case 'ranking': {
      // The field always submits the full order; if an answer exists it
      // must be a permutation of the option values.
      if (answer === undefined || answer === null) return null;
      const arr = Array.isArray(answer) ? answer : null;
      const values = question.options.map((o) => o.value);
      const isPermutation =
        arr !== null && arr.length === values.length && values.every((v) => arr.includes(v));
      if (!isPermutation) {
        return { code: 'ranking', message: 'Please rank every item' };
      }
      return null;
    }

    case 'matrix': {
      if (!question.required) return null;
      const obj =
        answer !== null && typeof answer === 'object' && !Array.isArray(answer)
          ? (answer as Record<string, unknown>)
          : {};
      const unanswered = question.rows.filter((r) => {
        const v = obj[r.value];
        if (v === undefined || v === null || v === '') return true;
        if (Array.isArray(v) && v.length === 0) return true;
        return false;
      });
      if (unanswered.length > 0) {
        return { code: 'required', message: 'Please answer every row' };
      }
      return null;
    }

    case 'single_choice':
    case 'dropdown': {
      const required = question.required ?? true;
      if (required && isBlankString(answer)) {
        return { code: 'required', message: 'Please pick one' };
      }
      return null;
    }

    case 'yes_no': {
      const required = question.required ?? true;
      if (required && isBlankString(answer)) {
        return { code: 'required', message: 'Please pick yes or no' };
      }
      return null;
    }

    case 'legal': {
      const required = question.required ?? true;
      if (required && isBlankString(answer)) {
        return { code: 'required', message: 'Please choose an option' };
      }
      return null;
    }

    case 'nps': {
      const required = question.required ?? false;
      if (required && (answer === undefined || answer === null)) {
        return { code: 'required', message: 'Please pick a number' };
      }
      if (typeof answer === 'number' && (answer < 0 || answer > 10)) {
        return { code: 'range', message: 'Pick a number from 0 to 10' };
      }
      return null;
    }

    case 'contact_info': {
      if (answer !== undefined && answer !== null && !isRecord(answer)) {
        return { code: 'shape', message: 'Please fill this in' };
      }
      return firstPartError(contactErrors(question, answer));
    }

    case 'address': {
      if (answer !== undefined && answer !== null && !isRecord(answer)) {
        return { code: 'shape', message: 'Please fill this in' };
      }
      return firstPartError(addressErrors(question, answer));
    }

    case 'signature': {
      const blank =
        answer === undefined ||
        answer === null ||
        (isRecord(answer) && Object.keys(answer).length === 0);
      if (blank) {
        return question.required ? { code: 'required', message: 'Please sign here' } : null;
      }
      if (!isRecord(answer)) return { code: 'shape', message: 'Please sign here' };
      const path = signaturePathOf(answer);
      if (path !== null) {
        const strokes = parseSignaturePath(path);
        if (!strokes) {
          return {
            code: 'shape',
            message: 'That signature didn’t come through. Clear it and sign again.',
          };
        }
        if (!isRealSignature(strokes)) {
          return { code: 'too_small', message: 'Please sign with a full stroke, not a dot' };
        }
        return null;
      }
      if (typeof answer.typed === 'string' && question.allowTyped !== false) {
        const typed = answer.typed.trim();
        if (typed.length < 2) return { code: 'typed', message: 'Please type your full name' };
        if (typed.length > SIG_TYPED_MAX) {
          return { code: 'too_long', message: `Max ${SIG_TYPED_MAX} characters` };
        }
        return null;
      }
      return { code: 'shape', message: 'Please sign here' };
    }

    case 'image_pin': {
      const pins = isRecord(answer) && Array.isArray(answer.pins) ? answer.pins : null;
      if (answer === undefined || answer === null || (pins !== null && pins.length === 0)) {
        return question.required
          ? { code: 'required', message: 'Tap the photo to mark a spot' }
          : null;
      }
      if (pins === null || pins.some((p) => !parsePin(p))) {
        return {
          code: 'shape',
          message: 'Those pins didn’t come through. Clear them and try again.',
        };
      }
      const limit = pinLimit(question as unknown as Record<string, unknown>);
      if (pins.length > limit) {
        return {
          code: 'max_pins',
          message: `Mark at most ${limit} ${limit === 1 ? 'spot' : 'spots'}`,
        };
      }
      const notes = isRecord(answer) && Array.isArray(answer.notes) ? answer.notes : [];
      if (notes.some((n) => typeof n !== 'string' || n.length > PIN_NOTE_MAX)) {
        return { code: 'too_long', message: `Keep each note under ${PIN_NOTE_MAX} characters` };
      }
      return null;
    }

    case 'voice_note': {
      const blank =
        answer === undefined ||
        answer === null ||
        (isRecord(answer) && Object.keys(answer).length === 0);
      if (blank) {
        if (!question.required) return null;
        return {
          code: 'required',
          message:
            question.allowTyped === false
              ? 'Please record a voice note'
              : 'Please record or type an answer',
        };
      }
      if (!isRecord(answer)) return { code: 'shape', message: 'Please record a voice note' };
      if (voiceAudioOf(answer)) {
        const sec = voiceSecondsOf(answer);
        if (answer.sec !== undefined && (sec === null || sec > voiceMaxSeconds(question) + 2)) {
          return { code: 'shape', message: 'That recording didn’t come through. Record it again.' };
        }
        return null;
      }
      if (typeof answer.typed === 'string' && question.allowTyped !== false) {
        const typed = answer.typed.trim();
        if (typed.length === 0) {
          return question.required
            ? { code: 'required', message: 'Please type your answer' }
            : null;
        }
        if (typed.length > VOICE_TYPED_MAX) {
          return { code: 'too_long', message: `Max ${VOICE_TYPED_MAX} characters` };
        }
        return null;
      }
      return { code: 'shape', message: 'Please record a voice note' };
    }

    case 'location': {
      const blank =
        answer === undefined ||
        answer === null ||
        (isRecord(answer) && Object.values(answer).every((v) => isBlankString(v)));
      if (blank) {
        return question.required
          ? { code: 'required', message: 'Please share your location, or type it instead' }
          : null;
      }
      if (!locationAnswerCore(question as unknown as Record<string, unknown>, answer, [])) {
        return { code: 'shape', message: 'That location didn’t come through. Try again.' };
      }
      return null;
    }

    case 'photo_checklist': {
      if (answer !== undefined && answer !== null && !isRecord(answer)) {
        return { code: 'shape', message: 'Please add the photos' };
      }
      const required = question.required ?? true;
      const missing = (question.items ?? []).length - photosTaken(question, answer).length;
      if (required && missing > 0) {
        return {
          code: 'required',
          message: missing === 1 ? 'One more photo to go' : `${missing} more photos to go`,
        };
      }
      return null;
    }

    case 'availability': {
      // Shape only: the grid field writes canonical ranges, and the server
      // re-encodes every answer against the published grid (ADR-065).
      const days = isRecord(answer) ? Object.values(answer).filter((v) => !isBlankString(v)) : [];
      if (answer !== undefined && answer !== null && !isRecord(answer)) {
        return { code: 'shape', message: 'Those times didn’t come through. Paint them again.' };
      }
      if (days.length === 0) {
        return question.required
          ? { code: 'required', message: 'Paint at least one time you’re free' }
          : null;
      }
      if (days.some((v) => typeof v !== 'string' || !RANGES_RE.test(v))) {
        return { code: 'shape', message: 'Those times didn’t come through. Paint them again.' };
      }
      return null;
    }

    case 'signup_slots': {
      // Picks against the slots listed. Spots left are the server's, and the field
      // and the server keep the answer canonical (signup.ts, ADR-066).
      const { slots, wait } = signupPicks(answer);
      const picks = [...slots, ...wait];
      if (!picks.length) {
        return question.required === false
          ? null
          : { code: 'required', message: 'Please pick one' };
      }
      // Below 1 is 1, as the field reads it (`signupMaxPicks`, ENG-02).
      const max = question.maxPicks! >= 1 ? question.maxPicks! : 1;
      if (picks.length > max) return { code: 'max_selections', message: `Pick up to ${max}` };
      if (
        (wait.length && !question.waitlist) ||
        picks.some((v, i) => picks.indexOf(v) !== i || !question.slots?.some((s) => s.value === v))
      ) {
        return { code: 'shape', message: 'That one isn’t available. Please pick again.' };
      }
      return null;
    }
  }
}
