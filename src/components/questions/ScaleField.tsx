'use client';

import { useId } from 'react';
import type { ScaleQuestion } from '@/types/Question.js';

type Props = {
  question: ScaleQuestion;
  initialValue: number | undefined;
  onAnswer: (value: number) => void;
};

export function ScaleField({ question, initialValue, onAnswer }: Props) {
  const labelId = useId();
  const step = question.step ?? 1;
  const cells: number[] = [];
  for (let v = question.min; v <= question.max; v += step) cells.push(v);

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {question.title}
      </h1>

      <div className="psw-scale" role="radiogroup" aria-labelledby={labelId}>
        <div className="psw-scale-row">
          {cells.map((v) => {
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
        {(question.minLabel || question.maxLabel) && (
          <div className="psw-scale-labels">
            <span>{question.minLabel ?? ''}</span>
            <span>{question.maxLabel ?? ''}</span>
          </div>
        )}
      </div>

      <div className="psw-actions">
        <span className="psw-hint">press a number ↑</span>
      </div>
    </div>
  );
}
