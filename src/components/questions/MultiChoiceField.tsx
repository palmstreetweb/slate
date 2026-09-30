'use client';

import { useCallback, useId, useRef, useState } from 'react';
import type { MultiChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { resolveOtherText, splitOther } from '@/logic/other.js';
import { useRegisterFormConfirm, useRegisterOtherKey } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { choiceListIsSplit } from '@/utils/choiceLayout.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { OTHER_EMPTY, OtherTextBox, useOtherChoice } from './OtherChoice.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: MultiChoiceQuestion;
  answers: LooseAnswers;
  /** Option values, plus at most one typed "Other" text (ADR-063). */
  selected: string[];
  onSelect: (values: string[]) => void;
  onAdvance: () => void;
  onType?: () => void;
};

export function MultiChoiceField({
  question,
  answers,
  selected,
  onSelect,
  onAdvance,
  onType,
}: Props) {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  const other = useOtherChoice(question, selected, labelId);
  const picked = other.enabled ? splitOther(question.options, selected).picked : selected;

  /** The answer: picked options, then the typed text while the Other box is open. */
  const withOther = useCallback(
    (values: string[]): string[] => {
      if (!other.open || !other.text.trim()) return values;
      const r = resolveOtherText(question.options, other.text);
      if (r.isOption) return values.includes(r.value) ? values : [...values, r.value];
      return [...values, r.value];
    },
    [other.open, other.text, question.options],
  );

  const toggle = (value: string) => {
    const next = picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value];
    onSelect(withOther(next));
    if (error) setError(null);
  };

  const toggleOther = useCallback(() => {
    if (other.open) {
      other.close();
      onSelect(picked);
    } else {
      other.openBox();
    }
    if (error) setError(null);
  }, [other, onSelect, picked, error]);

  const submit = useCallback(() => {
    if (other.open && !other.text.trim()) {
      other.setError(OTHER_EMPTY);
      shakeInvalid(other.inputRef.current);
      return;
    }
    const final = withOther(picked);
    const err = validate(question, final);
    if (err) {
      setError(err.message);
      shakeInvalid(choicesRef.current);
      return;
    }
    setError(null);
    if (other.open) onSelect(final);
    onAdvance();
  }, [question, picked, other, withOther, onSelect, onAdvance]);

  useRegisterFormConfirm(submit);
  useRegisterOtherKey(toggleOther, other.enabled);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        ref={choicesRef}
        className={`slate-choices${choiceListIsSplit(question.options) ? ' slate-choices--split' : ''}`}
        role="group"
        aria-labelledby={labelId}
      >
        {question.options.map((opt, i) => {
          const isSelected = picked.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => toggle(opt.value)}
              className={`slate-choice${isSelected ? ' slate-choice--selected' : ''}`}
            >
              <span className="slate-choice-badge">{CHOICE_LETTERS[i] ?? ''}</span>
              <span>
                {opt.label}
                {opt.description && <span className="slate-choice-desc">{opt.description}</span>}
              </span>
            </button>
          );
        })}
        {other.enabled ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={other.open}
            aria-controls={other.open ? other.boxId : undefined}
            onClick={toggleOther}
            className={`slate-choice slate-choice--other${other.open ? ' slate-choice--selected' : ''}`}
          >
            <span className="slate-choice-badge">{other.letter}</span>
            <span>{other.label}</span>
          </button>
        ) : null}
      </div>
      <OtherTextBox other={other} onEnter={submit} onType={onType} />

      {other.error || error ? (
        <p className="slate-err" aria-live="polite">
          ! {other.error ?? error}
        </p>
      ) : null}

      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint">tap keys to toggle, press Enter ↵</span>
      </div>
    </div>
  );
}
