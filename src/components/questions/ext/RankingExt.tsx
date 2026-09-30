/**
 * `ranking` through the on-demand registry (ADR-064). Rankings are rare (Build
 * with AI only drafts one when asked), so the field loads only for schemas
 * that use it, which keeps room in the engine's budget for Wave B. The field
 * itself is unchanged (RankingField.tsx, ADR-013).
 */

'use client';

import type { RankingQuestion } from '@/types/Question.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { RankingField } from '../RankingField.js';

export default function RankingExt({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
}: ExtFieldProps<RankingQuestion>) {
  return (
    <RankingField
      question={question}
      answers={answers}
      initialValue={Array.isArray(value) ? (value as string[]) : undefined}
      onAnswer={onAnswer}
      onAdvance={onAdvance}
    />
  );
}
