/**
 * `picture_choice` through the on-demand registry (ADR-064). The image grid
 * (with its "Other" pencil tile) is one of the larger core fields and most
 * forms don't use it, so it loads only for schemas that do — room in the
 * engine's budget for Wave B and later waves. The field itself is unchanged
 * (PictureChoiceField.tsx, ADR-013/063); letter keys still go through <Form>.
 */

'use client';

import type { PictureChoiceQuestion } from '@/types/Question.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { PictureChoiceField } from '../PictureChoiceField.js';

export default function PictureChoiceExt({
  question,
  answers,
  value,
  onAnswer,
  onCommit,
  onAdvance,
  onType,
  ping,
}: ExtFieldProps<PictureChoiceQuestion>) {
  return (
    <PictureChoiceField
      question={question}
      answers={answers}
      selected={value as string | string[] | undefined}
      onSelectSingle={onCommit}
      onSelectMulti={(vs) => {
        ping?.();
        onAnswer(vs);
      }}
      onAdvance={onAdvance}
      onType={onType}
    />
  );
}
