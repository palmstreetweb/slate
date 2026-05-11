/**
 * Per-question-type validators. Pure functions, no side effects.
 *
 * Inline validation happens on submit-attempt only (no live red borders as
 * the user types — per brief §10.4). The returned `ValidationError` is null
 * when the answer passes; otherwise it carries a stable `code` and a
 * human-readable `message`.
 */

import type { Question } from '@/types/Question.js';

export type ValidationError = { code: string; message: string };

export type ValidationResult = ValidationError | null;

/** RFC-lite email regex per brief §5. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      }
      return null;
    }

    case 'single_choice': {
      const required = question.required ?? true;
      if (required && isBlankString(answer)) {
        return { code: 'required', message: 'Please pick one' };
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
