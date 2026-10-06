/**
 * `multi_choice` through the on-demand registry (ADR-070). It loads while the
 * respondent is on the welcome screen or an earlier question, like the
 * picture grid and the dropdown before it (ADR-064, ADR-065), which keeps
 * room in the engine's budget for the rules that make sure no respondent is
 * ever held to a pick limit they can't meet. The field is MultiChoiceField.tsx;
 * letter keys still go through <Form>.
 */

'use client';

import type { MultiChoiceQuestion } from '@/types/Question.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { MultiChoiceField } from '../MultiChoiceField.js';

export default function MultiChoiceExt({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
  ping,
}: ExtFieldProps<MultiChoiceQuestion>) {
  return (
    <MultiChoiceField
      question={question}
      answers={answers}
      selected={Array.isArray(value) ? (value as string[]) : undefined}
      onSelect={(vs) => {
        ping?.();
        onAnswer(vs);
      }}
      onAdvance={onAdvance}
      onType={onType}
    />
  );
}
