/**
 * Picture choice — image grid. Single-select clicks auto-advance (the
 * renderer passes a select-and-advance callback); `multiple: true`
 * toggles selections and confirms with OK.
 */

'use client';

import { useId, useState } from 'react';
import type { PictureChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: PictureChoiceQuestion;
  answers: LooseAnswers;
  selected: string | string[] | undefined;
  /** Single mode — select + auto-advance. */
  onSelectSingle: (value: string) => void;
  /** Multi mode — replace the selection array. */
  onSelectMulti: (values: string[]) => void;
  onAdvance: () => void;
};

export function PictureChoiceField({
  question,
  answers,
  selected,
  onSelectSingle,
  onSelectMulti,
  onAdvance,
}: Props) {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);
  const multiple = question.multiple === true;
  const selectedArr = multiple
    ? Array.isArray(selected)
      ? selected
      : []
    : typeof selected === 'string'
      ? [selected]
      : [];

  const toggle = (value: string) => {
    const next = selectedArr.includes(value)
      ? selectedArr.filter((v) => v !== value)
      : [...selectedArr, value];
    onSelectMulti(next);
    if (error) setError(null);
  };

  const submit = () => {
    const err = validate(question, multiple ? selectedArr : selectedArr[0]);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAdvance();
  };

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        className="psw-picture-grid"
        role={multiple ? 'group' : 'radiogroup'}
        aria-labelledby={labelId}
      >
        {question.options.map((opt, i) => {
          const isSelected = selectedArr.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={isSelected}
              onClick={() => (multiple ? toggle(opt.value) : onSelectSingle(opt.value))}
              className={`psw-picture${isSelected ? ' psw-picture--selected' : ''}`}
            >
              <img src={opt.src} alt={opt.alt ?? opt.label} className="psw-picture-img" />
              <span className="psw-picture-caption">
                <span className="psw-choice-badge">{CHOICE_LETTERS[i] ?? ''}</span>
                <span>{opt.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="psw-err" aria-live="polite">
          ! {error}
        </p>
      )}

      {multiple ? (
        <div className="psw-actions">
          <button type="button" className="psw-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="psw-hint">tap keys to toggle, OK to continue</span>
        </div>
      ) : (
        <p className="psw-hint" style={{ marginTop: 20 }}>
          tap a key (A, B, C) or click to select
        </p>
      )}
    </div>
  );
}
