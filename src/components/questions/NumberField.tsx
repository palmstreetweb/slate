'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { NumberQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { NOT_A_NUMBER, parseTypedNumber } from '@/logic/numberEntry.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { focusAfter } from '@/utils/focus.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import { FieldError } from './ext/fieldMessage.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: NumberQuestion;
  answers: LooseAnswers;
  initialValue: number | undefined;
  onAnswer: (value: number | undefined) => void;
  onAdvance: () => void;
  onType?: () => void;
};

export function NumberField({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
  onType,
}: Props) {
  const [text, setText] = useState<string>(initialValue !== undefined ? String(initialValue) : '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const unitId = `${labelId}-unit`;
  const errId = `${labelId}-err`;

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = useCallback(() => {
    // "1,000", "$150" and "5 sq ft" read as numbers; "0x0A" and "1e1" don't.
    const num = parseTypedNumber(text, question.prefix, question.unit);
    if (Number.isNaN(num)) {
      setError(NOT_A_NUMBER);
      shakeInvalid(inputRef.current);
      return;
    }
    const err = validate(question, num);
    if (err) {
      setError(err.message);
      shakeInvalid(inputRef.current);
      return;
    }
    setError(null);
    onAnswer(num);
    onAdvance();
  }, [question, text, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isTypewriterKey(e)) onType?.();
    // A held Enter (key repeat) never confirms (ADR-069, ENG-07).
    if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
      e.preventDefault();
      submit();
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      enterKeyHint="next"
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
      aria-describedby={
        [question.unit ? unitId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined
      }
      className={`slate-input${error ? ' slate-input--error' : ''}`}
    />
  );

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        {question.prefix || question.unit ? (
          // Prefix / unit (ADR-063): display only, the answer stays a number.
          <div className={`slate-num-wrap${error ? ' slate-num-wrap--error' : ''}`}>
            {question.prefix ? (
              <span className="slate-num-affix" aria-hidden="true">
                {question.prefix}
              </span>
            ) : null}
            {input}
            {question.unit ? (
              <span id={unitId} className="slate-num-affix slate-num-affix--unit">
                {question.unit}
              </span>
            ) : null}
          </div>
        ) : (
          input
        )}
        <FieldError id={errId} error={error} />
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint slate-keys">press Enter ↵</span>
        </div>
      </div>
    </div>
  );
}
