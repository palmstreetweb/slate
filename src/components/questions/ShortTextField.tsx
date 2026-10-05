'use client';

import type { ShortTextQuestion } from '@/types/Question.js';
import { TextAnswer, type TextFieldProps } from './TextAnswer.js';

export function ShortTextField(props: TextFieldProps<ShortTextQuestion>) {
  return (
    <TextAnswer
      {...props}
      box={{
        type: 'text',
        autoComplete: 'off',
        placeholder: props.question.placeholder ?? 'Type your answer...',
      }}
      hint="press Enter ↵"
    />
  );
}
