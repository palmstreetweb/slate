'use client';

import { useId } from 'react';
import type { YesNoQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: YesNoQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: 'yes' | 'no') => void;
};

export function YesNoField({ question, answers, selected, onSelect }: Props) {
  const labelId = useId();
  const choices: ReadonlyArray<{ value: 'yes' | 'no'; label: string; badge: string }> = [
    { value: 'yes', label: question.yesLabel ?? 'Yes', badge: 'Y' },
    { value: 'no', label: question.noLabel ?? 'No', badge: 'N' },
  ];

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div className="slate-choices" role="radiogroup" aria-labelledby={labelId}>
        {choices.map((c) => {
          const isSelected = selected === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(c.value)}
              className={`slate-choice${isSelected ? ' slate-choice--selected' : ''}`}
            >
              <span className="slate-choice-badge">{c.badge}</span>
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>
      <p className="slate-hint" style={{ marginTop: 20 }}>
        press Y or N, or click to select
      </p>
    </div>
  );
}
