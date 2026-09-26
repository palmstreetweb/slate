'use client';

import { useId } from 'react';
import type { SingleChoiceQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { choiceListIsSplit } from '@/utils/choiceLayout.js';
import { CHOICE_LETTERS } from '@/utils/letters.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { ChoiceBadge } from './ChoiceBadge.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: SingleChoiceQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: string) => void;
};

export function SingleChoiceField({ question, answers, selected, onSelect }: Props) {
  const labelId = useId();
  const { committed, markCommitted } = useChoiceCommit(selected);
  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        className={`slate-choices${choiceListIsSplit(question.options) ? ' slate-choices--split' : ''}${committed ? ' slate-choices--committed' : ''}`}
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {question.options.map((opt, i) => {
          const isSelected = selected === opt.value;
          const isCommitted = isSelected && committed === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                markCommitted(opt.value);
                onSelect(opt.value);
              }}
              className={`slate-choice${isSelected ? ' slate-choice--selected' : ''}${isCommitted ? ' slate-choice--committed' : ''}`}
            >
              <ChoiceBadge letter={CHOICE_LETTERS[i] ?? ''} committed={isCommitted} />
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
      <p className="slate-hint" style={{ marginTop: 20 }}>
        tap a key (A, B, C, D) or click to select
      </p>
    </div>
  );
}
