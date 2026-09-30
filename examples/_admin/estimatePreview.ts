/**
 * Sample answers for previewing the instant estimate in the editor (ADR-064):
 * the first priced option of each priced choice question, and one unit (or
 * the minimum) of each priced number. The canvas shows the Thank You reveal
 * with these, so an owner sees what respondents will see.
 */

import type { Answers, Estimate, Schema } from '@/index.js';
import { computeEstimate } from '@/logic/estimate.js';

export function sampleEstimateAnswers(schema: Pick<Schema, 'questions'>): Answers {
  const out: Answers = {};
  for (const q of schema.questions) {
    if (
      q.type === 'single_choice' ||
      q.type === 'dropdown' ||
      q.type === 'picture_choice' ||
      q.type === 'multi_choice'
    ) {
      const priced = q.options.find((o) => typeof o.price === 'number');
      if (!priced) continue;
      const many = q.type === 'multi_choice' || (q.type === 'picture_choice' && q.multiple);
      out[q.id] = many ? [priced.value] : priced.value;
    } else if (q.type === 'number' && typeof q.unitPrice === 'number') {
      out[q.id] = Math.max(1, q.min ?? 1);
    }
  }
  return out;
}

/** The estimate the editor previews on an ending, or null when nothing is priced. */
export function sampleEstimate(schema: Pick<Schema, 'questions' | 'estimate'>): Estimate | null {
  return computeEstimate(schema, sampleEstimateAnswers(schema));
}
