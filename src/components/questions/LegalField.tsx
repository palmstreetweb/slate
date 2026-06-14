'use client';

import { useId } from 'react';
import type { LegalQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: LegalQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: 'accept' | 'decline') => void;
};

export function LegalField({ question, answers, selected, onSelect }: Props) {
  const labelId = useId();
  const choices: ReadonlyArray<{ value: 'accept' | 'decline'; label: string; badge: string }> = [
    { value: 'accept', label: question.acceptLabel ?? 'I accept', badge: 'A' },
    { value: 'decline', label: question.declineLabel ?? "I don't accept", badge: 'B' },
  ];

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      {question.body && <p className="slate-subtitle">{question.body}</p>}

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
        tap a key (A, B) or click to select
      </p>
    </div>
  );
}
