/**
 * Per-question-type validators. Pure functions, no side effects.
 *
 * Inline validation happens on submit-attempt only (no live red borders as
 * the user types — per brief §10.4). The returned `ValidationError` is null
 * when the answer passes; otherwise it carries a stable `code` and a
 * human-readable `message`.
 */

import type { Question } from '@/types/Question.js';
import { isScaleStepValue } from '@/utils/scaleStep.js';

export type ValidationError = { code: string; message: string };

export type ValidationResult = ValidationError | null;

/** RFC-lite email regex per brief §5. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Loose website check — scheme optional, needs a host with a dot. */
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

function isBlankString(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === '';
}

function isMissingValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export function validate(question: Question, answer: unknown): ValidationResult {
  switch (question.type) {
    case 'welcome':
    case 'statement':
    case 'review':
    case 'thanks':
      return null;

    case 'short_text': {
      if (question.required && isBlankString(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'string') {
        if (question.maxLength !== undefined && answer.length > question.maxLength) {
          return { code: 'too_long', message: `Max ${question.maxLength} characters` };
        }
        if (question.pattern && answer.length > 0 && !question.pattern.test(answer)) {
          return {
            code: 'pattern',
            message: question.patternError ?? 'Invalid format',
          };
        }
      }
      return null;
    }

    case 'long_text': {
      if (question.required && isBlankString(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'string' && question.maxLength !== undefined) {
        if (answer.length > question.maxLength) {
          return { code: 'too_long', message: `Max ${question.maxLength} characters` };
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
        return { code: 'required', message: 'Please pick a date' };
      }
      if (typeof answer === 'string' && answer.length > 0) {
        if (!isValidIsoDate(answer)) {
          return { code: 'date', message: "That doesn't look like a valid date" };
        }
        if (question.min !== undefined && answer < question.min) {
          return { code: 'min', message: `Earliest allowed date is ${question.min}` };
        }
        if (question.max !== undefined && answer > question.max) {
          return { code: 'max', message: `Latest allowed date is ${question.max}` };
        }
      }
      return null;
    }

    case 'number': {
      if (question.required && isMissingValue(answer)) {
        return { code: 'required', message: 'Please fill this in' };
      }
      if (typeof answer === 'number') {
        if (question.min !== undefined && answer < question.min) {
          return { code: 'min', message: `Minimum is ${question.min}` };
        }
        if (question.max !== undefined && answer > question.max) {
          return { code: 'max', message: `Maximum is ${question.max}` };
        }
      }
      return null;
    }

    case 'scale': {
      const required = question.required ?? false;
      if (required && (answer === undefined || answer === null)) {
        return { code: 'required', message: 'Please pick a value' };
      }
      if (typeof answer === 'number') {
        if (answer < question.min) {
          return { code: 'min', message: `Minimum is ${question.min}` };
        }
        if (answer > question.max) {
          return { code: 'max', message: `Maximum is ${question.max}` };
        }
        const step = question.step ?? 1;
        if (!isScaleStepValue(answer, question.min, question.max, step)) {
          return { code: 'step', message: `Pick a value in steps of ${step}` };
        }
      }
      return null;
    }

    case 'file_upload': {
      if (question.required) {
        const hasFile =
          (typeof File !== 'undefined' && answer instanceof File) ||
          (typeof answer === 'string' && answer.trim() !== '');
        if (!hasFile) {
          return { code: 'required', message: 'Please choose a file' };
        }
      }
      return null;
    }

    case 'picture_choice': {
      if (question.multiple) {
        const arr = Array.isArray(answer) ? answer : [];
        const min = question.min ?? 0;
        if (arr.length < min) {
          return {
            code: 'min_selections',
            message: min === 1 ? 'Please pick at least one' : `Pick at least ${min}`,
          };
        }
        if (question.max !== undefined && arr.length > question.max) {
          return { code: 'max_selections', message: `Pick at most ${question.max}` };
        }
        return null;
      }
      const required = question.required ?? true;
      if (required && isBlankString(answer)) {
        return { code: 'required', message: 'Please pick one' };
      }
      return null;
    }

    case 'ranking': {
      // The field always submits the full order; if an answer exists it
      // must be a permutation of the option values.
      if (answer === undefined || answer === null) return null;
      const arr = Array.isArray(answer) ? answer : null;
      const values = question.options.map((o) => o.value);
      const isPermutation =
        arr !== null &&
        arr.length === values.length &&
        values.every((v) => arr.includes(v));
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
        return { code: 'required', message: 'Please pick a value' };
      }
      if (typeof answer === 'number' && (answer < 0 || answer > 10)) {
        return { code: 'range', message: 'Pick a value between 0 and 10' };
      }
      return null;
    }

    case 'multi_choice': {
      const arr = Array.isArray(answer) ? answer : [];
      const min = question.min ?? 0;
      if (arr.length < min) {
        return {
          code: 'min_selections',
          message: min === 1 ? 'Please pick at least one' : `Pick at least ${min}`,
        };
      }
      if (question.max !== undefined && arr.length > question.max) {
        return { code: 'max_selections', message: `Pick at most ${question.max}` };
      }
      return null;
    }
  }
}
