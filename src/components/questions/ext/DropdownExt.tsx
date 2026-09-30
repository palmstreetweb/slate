/**
 * `dropdown` through the on-demand registry (ADR-065). The searchable select
 * (with its "Other" row) is one of the larger core fields and most forms
 * don't use it, so it loads only for schemas that do — room in the engine's
 * budget for Wave C, as ADR-064 planned. The field itself is unchanged
 * (DropdownField.tsx, ADR-011/063).
 */

'use client';

import type { DropdownQuestion } from '@/types/Question.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { DropdownField } from '../DropdownField.js';

export default function DropdownExt({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onAdvanceSilent,
  ping,
}: ExtFieldProps<DropdownQuestion>) {
  return (
    <DropdownField
      question={question}
      answers={answers}
      selected={value as string | undefined}
      onSelect={(v) => {
        ping?.();
        onAnswer(v);
      }}
      // A pick already pinged; its auto-advance is quiet, OK / Enter is not.
      onAdvance={onAdvanceSilent ?? onAdvance}
      onSubmit={onAdvance}
    />
  );
}
