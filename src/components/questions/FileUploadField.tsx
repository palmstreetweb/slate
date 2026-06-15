'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FileUploadQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import {
  describeFileUploadAnswer,
  formatBytes,
  isFileUploadRef,
  type FileUploadMeta,
} from '@/utils/fileUploadRef.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import { formatFileUploadError, resolveFileInputAccept } from '@/utils/fileUploadAccept.js';
import { shouldOptimizeImage } from '@/utils/prepareFileForUpload.js';
import { resolveTitle } from './_resolveTitle.js';

export type { FileUploadHandler };

type Props = {
  question: FileUploadQuestion;
  answers: LooseAnswers;
  initialValue: File | string | undefined;
  onAnswer: (value: File | string | undefined) => void;
  onAdvance: () => void;
  onFileUpload?: FileUploadHandler;
  resolveFileUploadMeta?: (ref: string) => Promise<FileUploadMeta | null>;
};

export function FileUploadField({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
  onFileUpload,
  resolveFileUploadMeta,
}: Props) {
  const [value, setValue] = useState<File | string | undefined>(initialValue);
  const [meta, setMeta] = useState<FileUploadMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'optimize' | 'upload' | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (typeof value !== 'string' || !isFileUploadRef(value) || !resolveFileUploadMeta) {
      if (typeof value !== 'string' || !isFileUploadRef(value)) setMeta(null);
      return;
    }
    let cancelled = false;
    void resolveFileUploadMeta(value).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [value, resolveFileUploadMeta]);

  const pickFile = (file: File) => {
    if (question.maxSizeMb !== undefined && file.size > question.maxSizeMb * 1024 * 1024) {
      setError(
        question.maxSizeMb !== undefined
          ? `That file is too large — max ${question.maxSizeMb} MB.`
          : 'That file is too large.',
      );
      return;
    }
    setError(null);
    if (onFileUpload) {
      setUploading(true);
      setUploadPhase(shouldOptimizeImage(file) ? 'optimize' : 'upload');
      onFileUpload(file, question.id, { maxSizeMb: question.maxSizeMb })
        .then(async (ref) => {
          setValue(ref);
          onAnswer(ref);
          if (resolveFileUploadMeta) {
            setMeta(await resolveFileUploadMeta(ref));
          }
        })
        .catch((err: unknown) => {
          setError(formatFileUploadError(err, question.maxSizeMb));
        })
        .finally(() => {
          setUploading(false);
          setUploadPhase(null);
        });
    } else {
      setValue(file);
      onAnswer(file);
      setMeta(null);
    }
  };

  const clear = () => {
    setValue(undefined);
    onAnswer(undefined);
    setMeta(null);
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

  const described = describeFileUploadAnswer(value, meta);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <input
          ref={inputRef}
          type="file"
          {...(resolveFileInputAccept(question.accept)
            ? { accept: resolveFileInputAccept(question.accept) }
            : {})}
          aria-labelledby={labelId}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickFile(f);
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
              if (f) pickFile(f);
            }}
            aria-describedby={labelId}
          >
            {uploading ? (
              <span aria-live="polite">
                {uploadPhase === 'optimize' ? 'Optimizing & uploading…' : 'Uploading…'}
              </span>
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
              disabled={uploading}
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

export { formatBytes };
