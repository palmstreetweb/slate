/**
 * `file_upload` through the on-demand registry (ADR-063). The file field is the
 * heaviest core UI (drop screen, previews, HEIC path), and most forms never
 * ask for a file, so it loads only for schemas that do. The field itself is
 * unchanged (FileUploadField.tsx, ADR-012/032/033).
 */

'use client';

import type { FileUploadQuestion } from '@/types/Question.js';
import type { FileAnswer } from '@/types/Answers.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { FileUploadField } from '../FileUploadField.js';

export default function FileUploadExt({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onFileUpload,
  resolveFileUploadMeta,
}: ExtFieldProps<FileUploadQuestion>) {
  return (
    <FileUploadField
      question={question}
      answers={answers}
      initialValue={value as FileAnswer | undefined}
      onAnswer={onAnswer}
      onAdvance={onAdvance}
      onFileUpload={onFileUpload}
      resolveFileUploadMeta={resolveFileUploadMeta}
    />
  );
}
