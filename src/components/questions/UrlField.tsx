'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { UrlQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: UrlQuestion;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
};

/** Prefix `https://` when the user typed a bare domain. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function UrlField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = useCallback(() => {
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAnswer(normalizeUrl(value));
    onAdvance();
  }, [question, value, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="url"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          placeholder={question.placeholder ?? 'https://example.com'}
          aria-labelledby={labelId}
          aria-invalid={Boolean(error)}
          className={`slate-input${error ? ' slate-input--error' : ''}`}
          autoCapitalize="off"
          spellCheck={false}
        />
        {error && (
          <p className="slate-err" aria-live="polite">
            ! {error}
          </p>
        )}
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint">press Enter ↵</span>
        </div>
      </div>
    </div>
  );
}
