/**
 * Answers the studio stores itself — test runs in the preview (local or
 * cloud, where they go straight to the Data API) and portable / offline links
 * — reduced the way the submit Function reduces them before it stores
 * (ADR-068): a location keeps only its verdict, `{ area?, via }`, unless the
 * owner kept the approximate location. Same shared code as the Function
 * (`locationStoredCore`), so a test run looks exactly like a real response.
 */

import type { Answers, Question } from '@/index.js';
import { formZipAreas, locationStoredCore } from '@/logic/geo.js';

export function asStoredAnswers(questions: ReadonlyArray<Question>, answers: Answers): Answers {
  let out: Record<string, unknown> | null = null;
  let zips: string[] | null = null;
  for (const q of questions) {
    if (q.type !== 'location' || !Object.hasOwn(answers, q.id)) continue;
    zips ??= formZipAreas(questions);
    out ??= { ...answers };
    const v = locationStoredCore(q as unknown as Record<string, unknown>, answers[q.id], zips);
    if (v === undefined) delete out[q.id];
    else out[q.id] = v;
  }
  return (out ?? answers) as Answers;
}
