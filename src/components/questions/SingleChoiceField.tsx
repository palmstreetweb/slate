'use client';

import { useId } from 'react';
import type { SingleChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: SingleChoiceQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: string) => void;
};

export function SingleChoiceField({ question, answers, selected, onSelect }: Props) {
  const labelId = useId();
  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div className="psw-choices" role="radiogroup" aria-labelledby={labelId}>
        {question.options.map((opt, i) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(opt.value)}
              className={`psw-choice${isSelected ? ' psw-choice--selected' : ''}`}
            >
              <span className="psw-choice-badge">{CHOICE_LETTERS[i] ?? ''}</span>
              <span>
                {opt.label}
                {opt.description && (
                  <span className="psw-choice-desc">{opt.description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="psw-hint" style={{ marginTop: 20 }}>
        tap a key (A, B, C, D) or click to select
      </p>
    </div>
  );
}
