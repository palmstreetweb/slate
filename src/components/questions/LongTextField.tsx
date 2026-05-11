'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { LongTextQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { focusAfter } from '@/utils/focus.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: LongTextQuestion;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
};

export function LongTextField({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = () => {
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAnswer(value);
    onAdvance();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter inserts newline (browser default). Plain Enter submits.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          rows={3}
          placeholder={question.placeholder ?? 'Type your answer...'}
          maxLength={question.maxLength}
          aria-labelledby={labelId}
          aria-invalid={Boolean(error)}
          className={`psw-input${error ? ' psw-input--error' : ''}`}
        />
        {error && (
          <p className="psw-err" aria-live="polite">
            ! {error}
          </p>
        )}
        <div className="psw-actions">
          <button type="button" className="psw-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="psw-hint">Shift + Enter for new line</span>
        </div>
      </div>
    </div>
  );
}
