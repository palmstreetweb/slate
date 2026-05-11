/** Internal helper: resolve `DynamicTitle` (string | function) to string. */

import type { DynamicTitle } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';

export function resolveTitle(t: DynamicTitle | string, answers: LooseAnswers): string {
  if (typeof t === 'function') return t(answers);
  return t;
}
