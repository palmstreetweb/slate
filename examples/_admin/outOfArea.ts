/**
 * The editor's "Add an out of area ending" (ADR-064), as a pure transform:
 * a Thank You screen shown only when the address is outside its service
 * area, placed before the other endings (the first visible ending wins,
 * ADR-016), and a jump to it from the address so the rest of the form is
 * skipped. Everything uses existing logic — nothing new in the engine.
 */

import type { Question } from '@/index.js';
import { OUT_OF_AREA_VALUE } from '@/logic/address.js';
import { uniqueQuestionId } from './questionIds.js';

export function withOutOfAreaEnding(
  questions: ReadonlyArray<Question>,
  addressId: string,
): { questions: Question[]; endingId: string } {
  const endingId = uniqueQuestionId('out_of_area', new Set(questions.map((q) => q.id)));
  const outside = { field: addressId, op: 'equals' as const, value: OUT_OF_AREA_VALUE };
  const ending: Question = {
    id: endingId,
    type: 'thanks',
    title: 'Sorry — we don’t serve that area yet.',
    subtitle: 'Thanks for checking. We’ve kept your details in case that changes.',
    cta: 'Start over',
    visibleIf: outside,
  };
  const next = questions.map((q) =>
    q.id === addressId && q.type === 'address'
      ? ({ ...q, logic: [...(q.logic ?? []), { if: outside, goTo: endingId }] } as Question)
      : q,
  );
  const firstEnding = next.findIndex((q) => q.type === 'thanks');
  next.splice(firstEnding === -1 ? next.length : firstEnding, 0, ending);
  return { questions: next, endingId };
}
