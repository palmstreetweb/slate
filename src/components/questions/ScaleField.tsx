'use client';

import { useId } from 'react';
import type { ScaleQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: ScaleQuestion;
  answers: LooseAnswers;
  initialValue: number | undefined;
  onAnswer: (value: number) => void;
};

export function ScaleField({ question, answers, initialValue, onAnswer }: Props) {
  const labelId = useId();
  const step = question.step ?? 1;
  const cells: number[] = [];
  for (let v = question.min; v <= question.max; v += step) cells.push(v);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div className="slate-scale" role="radiogroup" aria-labelledby={labelId}>
        <div className="slate-scale-row">
          {cells.map((v) => {
            const selected = initialValue === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onAnswer(v)}
                className={`slate-scale-cell${selected ? ' slate-scale-cell--selected' : ''}`}
              >
                {v}
              </button>
            );
          })}
        </div>
        {(question.minLabel || question.maxLabel) && (
          <div className="slate-scale-labels">
            <span>{question.minLabel ?? ''}</span>
            <span>{question.maxLabel ?? ''}</span>
          </div>
        )}
      </div>

      <div className="slate-actions">
        <span className="slate-hint">press a number ↑</span>
      </div>
    </div>
  );
}
