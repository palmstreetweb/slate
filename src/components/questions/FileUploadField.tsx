/**
 * File upload — drop zone + browse button. Storage strategy per ADR-012:
 * when the host passes `onFileUpload` to `<Form>`, the file is handed off
 * at selection time and the returned URL/identifier string is stored as
 * the answer; otherwise the raw `File` object is stored and delivered in
 * the `onSubmit` payload.
 */

'use client';

import { useId, useRef, useState } from 'react';
import type { FileUploadQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { resolveTitle } from './_resolveTitle.js';

export type FileUploadHandler = (file: File, questionId: string) => Promise<string>;

type Props = {
  question: FileUploadQuestion;
  answers: LooseAnswers;
  initialValue: File | string | undefined;
  onAnswer: (value: File | string | undefined) => void;
  onAdvance: () => void;
  onFileUpload?: FileUploadHandler;
};

function describeAnswer(v: File | string | undefined): string | null {
  if (v === undefined || v === '') return null;
  if (typeof v === 'string') return v;
  return `${v.name} (${formatBytes(v.size)})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadField({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
  onFileUpload,
}: Props) {
  const [value, setValue] = useState<File | string | undefined>(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  const accept = (file: File) => {
    if (question.maxSizeMb !== undefined && file.size > question.maxSizeMb * 1024 * 1024) {
      setError(`File is too big — max ${question.maxSizeMb} MB`);
      return;
    }
    setError(null);
    if (onFileUpload) {
      setUploading(true);
      onFileUpload(file, question.id)
        .then((url) => {
          setValue(url);
          onAnswer(url);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Upload failed — try again';
          setError(msg);
        })
        .finally(() => setUploading(false));
    } else {
      setValue(file);
      onAnswer(file);
    }
  };

  const clear = () => {
    setValue(undefined);
    onAnswer(undefined);
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = () => {
    if (uploading) return;
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAdvance();
  };

  const described = describeAnswer(value);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <input
          ref={inputRef}
          type="file"
          accept={question.accept}
          aria-labelledby={labelId}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) accept(f);
          }}
        />

        {described === null ? (
          <button
            type="button"
            className={`slate-upload-zone${dragOver ? ' slate-upload-zone--over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) accept(f);
            }}
            aria-describedby={labelId}
          >
            {uploading ? (
              <span aria-live="polite">uploading...</span>
            ) : (
              <>
                <span className="slate-upload-cta">choose a file</span>
                <span className="slate-upload-hint">or drag and drop it here</span>
              </>
            )}
          </button>
        ) : (
          <div className="slate-upload-file">
            <span className="slate-upload-name">{described}</span>
            <button
              type="button"
              className="slate-upload-remove"
              onClick={clear}
              aria-label="Remove file"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <p className="slate-err" aria-live="polite">
            ! {error}
          </p>
        )}
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit} disabled={uploading}>
            OK <span aria-hidden>✓</span>
          </button>
          {question.maxSizeMb !== undefined && (
            <span className="slate-hint">max {question.maxSizeMb} MB</span>
          )}
        </div>
      </div>
    </div>
  );
}
