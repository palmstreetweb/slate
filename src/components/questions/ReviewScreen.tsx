/**
 * Review screen (roadmap Phase 5) — chrome step listing the answer-bearing
 * questions on the respondent's path with their answers in words and a
 * jump-to-edit button; an edit comes back here (ADR-069). A required
 * question still unanswered is marked. Confirm CTA advances (usually into
 * `thanks`, firing onSubmit).
 *
 * Loads on demand through ext/ReviewExt.tsx: the core passes in the rows
 * and its answer formatter, so this chunk imports none of the core's own
 * modules (only `validate`, which every on-demand field shares).
 */

'use client';

import { useId } from 'react';
import type { DynamicTitle, Question, ReviewQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { reviewText } from '@/logic/reviewText.js';

type Props = {
  question: ReviewQuestion;
  /** The answer-bearing questions on the respondent's path, in order. */
  rows: ReadonlyArray<Question>;
  answers: LooseAnswers;
  /** The core's answer formatter (`formatAnswerFor`). */
  format: (q: Question, v: unknown) => string;
  /** Jump back to a question for editing. */
  onEdit: (questionId: string) => void;
  onAdvance: () => void;
};

function titleOf(q: Question, answers: LooseAnswers): string {
  const t = (q as { title: DynamicTitle }).title;
  return typeof t === 'function' ? t(answers) : t;
}

export function ReviewScreen({ question, rows, answers, format, onEdit, onAdvance }: Props) {
  const labelId = useId();

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {question.title}
      </h1>
      {question.subtitle && <p className="slate-subtitle">{question.subtitle}</p>}

      <dl className="slate-review" aria-labelledby={labelId}>
        {rows.map((q) => {
          // Labels and words, never stored codes (ADR-063, ADR-069).
          const value = reviewText(q, answers[q.id], format);
          // A sign-up can be left empty when every spot is gone (MEDIA-07): not flagged.
          const missing =
            value === '' && q.type !== 'signup_slots' && validate(q, answers[q.id]) !== null;
          return (
            <div key={q.id} className="slate-review-row">
              <dt className="slate-review-q">{titleOf(q, answers)}</dt>
              <dd className="slate-review-a">
                <span
                  className={
                    missing
                      ? 'slate-review-empty slate-review-missing'
                      : value === ''
                        ? 'slate-review-empty'
                        : undefined
                  }
                >
                  {missing ? 'Needs an answer' : value === '' ? 'Not answered' : value}
                </span>
                <button
                  type="button"
                  className="slate-review-edit"
                  onClick={() => onEdit(q.id)}
                  aria-label={`Edit ${titleOf(q, answers)}`}
                >
                  edit
                </button>
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={onAdvance}>
          {question.cta ?? 'Looks good'} <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-key-hint">
          press <strong>Enter ↵</strong>
        </span>
      </div>
    </div>
  );
}
