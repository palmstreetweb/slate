'use client';

import type { EmailQuestion } from '@/types/Question.js';
import { TextAnswer, type TextFieldProps } from './TextAnswer.js';

export function EmailField(props: TextFieldProps<EmailQuestion>) {
  return (
    <TextAnswer
      {...props}
      box={{
        type: 'email',
        inputMode: 'email',
        autoComplete: 'email',
        placeholder: props.question.placeholder ?? 'name@example.com',
      }}
      hint="press Enter ↵"
    />
  );
}
