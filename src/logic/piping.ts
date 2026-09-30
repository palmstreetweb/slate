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
import { formatDateAnswer } from './dateValue.js';

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
): string {
  if (!template.includes('{{')) return template;
  return template.replace(PIPE_RE, (_match, token: string) => {
    if (token === 'score') return String(score);
    const id = token.slice('field:'.length);
    return formatAnswerFor(
      questions?.find((q) => q.id === id),
      answers[id],
    );
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
): Question {
  const out: Record<string, unknown> = { ...q };
  const title = (q as { title: string | ((a: LooseAnswers) => string) }).title;
  out.title = pipe(typeof title === 'function' ? title(answers) : title, answers, score, questions);
  if ('subtitle' in q && typeof q.subtitle === 'string') {
    out.subtitle = pipe(q.subtitle, answers, score, questions);
  }
  if ('body' in q && typeof q.body === 'string') {
    out.body = pipe(q.body, answers, score, questions);
  }
  return out as unknown as Question;
}
