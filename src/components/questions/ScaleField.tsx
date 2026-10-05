/**
 * The numbers scale: one button per value, min to max by step. A tap answers
 * and moves on; Skip (when optional) or OK (once answered) moves on without
 * one. Loaded on demand with the other long-standing fields (CoreFieldsExt).
 */

'use client';

import { useId, useRef } from 'react';
import type { ScaleQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { scaleValues } from './ext/scaleCells.js';
import { TapActions } from './ext/TapActions.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: ScaleQuestion;
  answers: LooseAnswers;
  initialValue: number | undefined;
  /** Store the pick and move on after the commit beat. */
  onAnswer: (value: number) => void;
  /** Move on without a pick (Skip) or with the one already made (OK). */
  onAdvance: () => void;
};

export function ScaleField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const rowRef = useRef<HTMLDivElement>(null);
  // Rounded values, a usable step and at most 101 cells, whatever the schema says.
  const cells = scaleValues(question);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        ref={rowRef}
        className="slate-scale"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={errId}
      >
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

      <TapActions
        answered={initialValue !== undefined}
        required={question.required === true}
        check={() => validate(question, initialValue)?.message ?? null}
        onAdvance={onAdvance}
        target={rowRef}
        errorId={errId}
        hint={<span className="slate-hint slate-keys">press a number ↑</span>}
      />
    </div>
  );
}
