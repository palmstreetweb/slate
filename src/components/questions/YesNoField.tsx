'use client';

import { useId } from 'react';
import type { YesNoQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { ChoiceBadge } from './ChoiceBadge.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: YesNoQuestion;
  answers: LooseAnswers;
  selected: string | undefined;
  onSelect: (value: 'yes' | 'no') => void;
  /** Move on without answering: an optional question offers Skip (and Enter). */
  onSkip?: () => void;
};

export function YesNoField({ question, answers, selected, onSelect, onSkip }: Props) {
  const labelId = useId();
  const { committed, markCommitted } = useChoiceCommit(selected);
  // Optional and unanswered: Skip (and Enter). Answered (a link's prefill,
  // Back, Resume): OK or Enter keeps the pick (audit 2026-10); a tap on a
  // choice moves on too.
  const go = question.required === false || selected ? onSkip : undefined;
  useRegisterFormConfirm(go!, Boolean(go), 500);
  const choices: ReadonlyArray<{ value: 'yes' | 'no'; label: string; badge: string }> = [
    { value: 'yes', label: question.yesLabel ?? 'Yes', badge: 'Y' },
    { value: 'no', label: question.noLabel ?? 'No', badge: 'N' },
  ];

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        className={`slate-choices${committed ? ' slate-choices--committed' : ''}`}
        role="radiogroup"
        aria-labelledby={labelId}
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
      {go ? (
        <div className="slate-actions">
          <button
            type="button"
            className={selected ? 'slate-ok-btn' : 'slate-ok-btn slate-ok-btn--skip'}
            onClick={go}
          >
            {selected ? (
              <>
                OK <span aria-hidden>✓</span>
              </>
            ) : (
              'Skip'
            )}
          </button>
          <span className="slate-hint slate-key-hint">press Y or N, or Enter ↵</span>
        </div>
      ) : (
        <p className="slate-hint slate-key-hint" style={{ marginTop: 20 }}>
          press Y or N, or click to choose
        </p>
      )}
    </div>
  );
}
