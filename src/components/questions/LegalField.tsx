'use client';

import { useId, useRef } from 'react';
import type { LegalQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { ChoiceBadge } from './ChoiceBadge.js';
import { TapActions } from './ext/TapActions.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: LegalQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: 'accept' | 'decline') => void;
  /** Move on without a pick (Skip, when optional) or with the one already made (OK). */
  onAdvance: () => void;
};

export function LegalField({ question, answers, selected, onSelect, onAdvance }: Props) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const groupRef = useRef<HTMLDivElement>(null);
  const { committed, markCommitted } = useChoiceCommit(selected);
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

      <div
        ref={groupRef}
        className={`slate-choices${committed ? ' slate-choices--committed' : ''}`}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={errId}
      >
        {choices.map((c) => {
          const isSelected = selected === c.value;
          const isCommitted = isSelected && committed === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                markCommitted(c.value);
                onSelect(c.value);
              }}
              className={`slate-choice${isSelected ? ' slate-choice--selected' : ''}${isCommitted ? ' slate-choice--committed' : ''}`}
            >
              <ChoiceBadge letter={c.badge} committed={isCommitted} />
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>
      <TapActions
        answered={selected !== undefined}
        required={question.required ?? true}
        check={() => validate(question, selected)?.message ?? null}
        onAdvance={onAdvance}
        target={groupRef}
        errorId={errId}
        hint={<span className="slate-hint slate-keys">tap a key (A, B) or click to select</span>}
      />
    </div>
  );
}
