'use client';

import type { LongTextQuestion } from '@/types/Question.js';
import { textMax } from '@/logic/validation.js';
import { TextAnswer, type TextFieldProps } from './TextAnswer.js';

export function LongTextField(props: TextFieldProps<LongTextQuestion>) {
  return (
    <TextAnswer
      {...props}
      box={{ rows: 3, placeholder: props.question.placeholder ?? 'Type your answer...' }}
      multiline
      max={textMax(props.question)}
      hint="Shift + Enter for new line"
    />
  );
}
