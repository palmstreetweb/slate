/**
 * Net Promoter Score — fixed 0–10 row with the standard anchor labels.
 * Reuses the scale cell styling; selecting auto-advances (caller decides).
 */

'use client';

import { useId } from 'react';
import type { NpsQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: NpsQuestion;
  answers: LooseAnswers;
  initialValue: number | undefined;
  onAnswer: (value: number) => void;
};

const NPS_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function NpsField({ question, answers, initialValue, onAnswer }: Props) {
  const labelId = useId();

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div className="psw-scale" role="radiogroup" aria-labelledby={labelId}>
        <div className="psw-scale-row">
          {NPS_VALUES.map((v) => {
            const selected = initialValue === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onAnswer(v)}
                className={`psw-scale-cell${selected ? ' psw-scale-cell--selected' : ''}`}
              >
                {v}
              </button>
            );
          })}
        </div>
        <div className="psw-scale-labels">
          <span>{question.minLabel ?? 'Not at all likely'}</span>
          <span>{question.maxLabel ?? 'Extremely likely'}</span>
        </div>
      </div>

      <div className="psw-actions">
        <span className="psw-hint">press a number ↑</span>
      </div>
    </div>
  );
}
