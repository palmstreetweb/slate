/**
 * Quiz score, server side (audit 2026-10, ADR-071). The submit Function
 * recomputes `meta.score` from the PUBLISHED schema's option scores and the
 * sanitized answers, replacing anything the browser sent — so the Score column
 * an owner exports always matches the options they published (the estimate got
 * the same treatment in ADR-064).
 *
 * Same rules as the engine's `computeScore` (src/logic/scoring.ts, ADR-016),
 * written for an untyped schema because Functions deploy from this folder
 * alone. tests/scoreServer.test.ts checks the two agree.
 */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** The published option's score, or 0 when there is none (or it isn't a finite number). */
function scoreOf(options: unknown[], value: unknown): number {
  const option = options.find((o) => isObj(o) && o.value === value);
  const score = isObj(option) ? option.score : undefined;
  return typeof score === 'number' && Number.isFinite(score) ? score : 0;
}

function optionScore(options: unknown, value: unknown): number {
  if (!Array.isArray(options)) return 0;
  if (typeof value === 'string') return scoreOf(options, value);
  if (Array.isArray(value)) return value.reduce<number>((sum, v) => sum + scoreOf(options, v), 0);
  return 0;
}

/** Total score for the answers kept, from the published schema. Always a finite number. */
export function computeScoreCore(schema: unknown, answers: Obj): number {
  const questions = isObj(schema) ? schema.questions : undefined;
  if (!Array.isArray(questions)) return 0;
  let total = 0;
  for (const q of questions) {
    if (!isObj(q) || typeof q.id !== 'string') continue;
    switch (q.type) {
      case 'single_choice':
      case 'multi_choice':
      case 'dropdown':
      case 'picture_choice':
        total += optionScore(q.options, answers[q.id]);
        break;
      default:
        break;
    }
  }
  return Number.isFinite(total) ? total : 0;
}
