'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { NumberQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: NumberQuestion;
  answers: LooseAnswers;
  initialValue: number | undefined;
  onAnswer: (value: number | undefined) => void;
  onAdvance: () => void;
};

export function NumberField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [text, setText] = useState<string>(initialValue !== undefined ? String(initialValue) : '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    const num = trimmed === '' ? undefined : Number(trimmed);
    if (trimmed !== '' && Number.isNaN(num)) {
      setError('Please enter a number');
      return;
    }
    const err = validate(question, num);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAnswer(num);
    onAdvance();
  }, [question, text, onAnswer, onAdvance]);

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
          inputMode="decimal"
          pattern="[0-9]*[.]?[0-9]*"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          placeholder={question.placeholder ?? '0'}
          aria-labelledby={labelId}
          aria-invalid={Boolean(error)}
          className={`slate-input${error ? ' slate-input--error' : ''}`}
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
