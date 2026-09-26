/**
 * Picture choice — image grid. Single-select clicks auto-advance (the
 * renderer passes a select-and-advance callback); `multiple: true`
 * toggles selections and confirms with OK.
 */

'use client';

import { useCallback, useId, useRef, useState } from 'react';
import type { PictureChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { shakeInvalid } from '@/utils/motion.js';
import { ChoiceBadge } from './ChoiceBadge.js';
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
  const gridRef = useRef<HTMLDivElement>(null);
  // Single mode auto-advances, so it gets the commit beat (ADR-059).
  const { committed, markCommitted } = useChoiceCommit(
    multiple || typeof selected !== 'string' ? undefined : selected,
  );
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

  const submit = useCallback(() => {
    const err = validate(question, multiple ? selectedArr : selectedArr[0]);
    if (err) {
      setError(err.message);
      shakeInvalid(gridRef.current);
      return;
    }
    setError(null);
    onAdvance();
  }, [question, multiple, selectedArr, onAdvance]);

  useRegisterFormConfirm(submit, multiple);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        ref={gridRef}
        className={`slate-picture-grid${committed ? ' slate-picture-grid--committed' : ''}`}
        role={multiple ? 'group' : 'radiogroup'}
        aria-labelledby={labelId}
      >
        {question.options.map((opt, i) => {
          const isSelected = selectedArr.includes(opt.value);
          const isCommitted = !multiple && isSelected && committed === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={isSelected}
              onClick={() => {
                if (multiple) {
                  toggle(opt.value);
                  return;
                }
                markCommitted(opt.value);
                onSelectSingle(opt.value);
              }}
              className={`slate-picture${isSelected ? ' slate-picture--selected' : ''}${isCommitted ? ' slate-picture--committed' : ''}`}
            >
              <img src={opt.src} alt={opt.alt ?? opt.label} className="slate-picture-img" />
              <span className="slate-picture-caption">
                <ChoiceBadge letter={CHOICE_LETTERS[i] ?? ''} committed={isCommitted} />
                <span>{opt.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="slate-err" aria-live="polite">
          ! {error}
        </p>
      )}

      {multiple ? (
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint">tap keys to toggle, press Enter ↵</span>
        </div>
      ) : (
        <p className="slate-hint" style={{ marginTop: 20 }}>
          tap a key (A, B, C) or click to select
        </p>
      )}
    </div>
  );
}
