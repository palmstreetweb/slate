'use client';

import { useId, useState } from 'react';
import type { MultiChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: MultiChoiceQuestion;
  answers: LooseAnswers;
  selected: string[];
  onSelect: (values: string[]) => void;
  onAdvance: () => void;
};

export function MultiChoiceField({
  question,
  answers,
  selected,
  onSelect,
  onAdvance,
}: Props) {
  const labelId = useId();
  const [error, setError] = useState<string | null>(null);

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onSelect(next);
    if (error) setError(null);
  };

  const submit = () => {
    const err = validate(question, selected);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAdvance();
  };

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div className="slate-choices" role="group" aria-labelledby={labelId}>
        {question.options.map((opt, i) => {
          const isSelected = selected.includes(opt.value);
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
                {opt.description && (
                  <span className="slate-choice-desc">{opt.description}</span>
                )}
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

      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint">tap keys to toggle, OK to continue</span>
      </div>
    </div>
  );
}
