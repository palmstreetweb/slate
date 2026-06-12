/**
 * Answer piping — pure template resolver (ADR-014).
 *
 * Syntax (resolved in titles, subtitles, and body copy everywhere):
 *
 *   {{field:questionId}}   → the formatted answer for that question
 *   {{score}}              → the running score total (see scoring.ts)
 *
 * Unknown / unanswered fields resolve to '' so copy degrades gracefully
 * ("Thanks, {{field:name}}!" → "Thanks, !"). Function-style `DynamicTitle`
 * keeps working — functions are resolved first, then their output is piped.
 */

import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';

const PIPE_RE = /\{\{\s*(score|field:[\w-]+)\s*\}\}/g;

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
 * Resolve `{{field:id}}` and `{{score}}` placeholders in a template string.
 * Non-template strings pass through untouched (fast path).
 */
export function pipe(template: string, answers: LooseAnswers, score = 0): string {
  if (!template.includes('{{')) return template;
  return template.replace(PIPE_RE, (_match, token: string) => {
    if (token === 'score') return String(score);
    const id = token.slice('field:'.length);
    return formatAnswer(answers[id]);
  });
}

/**
 * Resolve all user-facing copy on a question — `title` (including
 * function-style `DynamicTitle`), `subtitle`, and `body` — into piped plain
 * strings. Field components downstream receive ready-to-render text.
 */
export function pipeQuestionCopy(q: Question, answers: LooseAnswers, score = 0): Question {
  const out: Record<string, unknown> = { ...q };
  const title = (q as { title: string | ((a: LooseAnswers) => string) }).title;
  out.title = pipe(typeof title === 'function' ? title(answers) : title, answers, score);
  if ('subtitle' in q && typeof q.subtitle === 'string') {
    out.subtitle = pipe(q.subtitle, answers, score);
  }
  if ('body' in q && typeof q.body === 'string') {
    out.body = pipe(q.body, answers, score);
  }
  return out as unknown as Question;
}
