/**
 * Net Promoter Score — fixed 0–10 row with the standard anchor labels: the
 * numbers scale with NPS's range and wording. Selecting auto-advances (caller
 * decides); Skip / OK as on the scale.
 */

'use client';

import type { NpsQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { ScaleField } from './ScaleField.js';

type Props = {
  question: NpsQuestion;
  answers: LooseAnswers;
  initialValue: number | undefined;
  onAnswer: (value: number) => void;
  onAdvance: () => void;
};

export function NpsField({ question, ...rest }: Props) {
  return (
    <ScaleField
      question={{
        id: question.id,
        type: 'scale',
        title: question.title,
        required: question.required,
        min: 0,
        max: 10,
        minLabel: question.minLabel ?? 'Not at all likely',
        maxLabel: question.maxLabel ?? 'Extremely likely',
      }}
      {...rest}
    />
  );
}
