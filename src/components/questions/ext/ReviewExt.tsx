/**
 * The Review step through the on-demand registry (ADR-070). Only forms with a
 * Review step use it, and it is never the first screen, so it loads while the
 * respondent answers the questions before it: room in the engine's budget
 * for the path rules (asking revealed questions, an edit returning here).
 */

'use client';

import type { ReviewQuestion } from '@/types/Question.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { ReviewScreen } from '../ReviewScreen.js';

export default function ReviewExt({
  question,
  answers,
  review,
  onAdvance,
}: ExtFieldProps<ReviewQuestion>) {
  return (
    <ReviewScreen
      question={question}
      rows={review?.rows ?? []}
      answers={answers}
      format={review?.format ?? ((_q, v) => (typeof v === 'string' ? v : ''))}
      onEdit={(id) => review?.onEdit(id)}
      onAdvance={onAdvance}
    />
  );
}
