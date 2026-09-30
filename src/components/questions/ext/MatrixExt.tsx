/**
 * `matrix` through the on-demand registry (ADR-064). Grids are rare and the
 * field is one of the larger ones, so it loads only for schemas that use it.
 * The field itself is unchanged (MatrixField.tsx, ADR-013).
 */

'use client';

import type { MatrixQuestion } from '@/types/Question.js';
import type { MatrixAnswer } from '@/types/Answers.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { MatrixField } from '../MatrixField.js';

export default function MatrixExt({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  ping,
}: ExtFieldProps<MatrixQuestion>) {
  return (
    <MatrixField
      question={question}
      answers={answers}
      initialValue={
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as MatrixAnswer)
          : undefined
      }
      onAnswer={(v) => {
        ping?.();
        onAnswer(v);
      }}
      onAdvance={onAdvance}
    />
  );
}
