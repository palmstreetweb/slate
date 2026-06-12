/**
 * Review screen (roadmap Phase 5) — chrome step listing every visible,
 * answer-bearing question with its formatted answer and a jump-to-edit
 * button. Confirm CTA advances (usually into `thanks`, firing onSubmit).
 */

'use client';

import { useId } from 'react';
import type { Question, ReviewQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { formatAnswer } from '@/logic/piping.js';

const CHROME = new Set(['welcome', 'statement', 'review', 'thanks']);

type Props = {
  question: ReviewQuestion;
  /** The currently visible questions list (chrome included). */
  visible: ReadonlyArray<Question>;
  answers: LooseAnswers;
  /** Jump back to a question for editing. */
  onEdit: (questionId: string) => void;
  onAdvance: () => void;
};

function titleOf(q: Question, answers: LooseAnswers): string {
  const t = (q as { title: string | ((a: LooseAnswers) => string) }).title;
  return typeof t === 'function' ? t(answers) : t;
}

export function ReviewScreen({ question, visible, answers, onEdit, onAdvance }: Props) {
  const labelId = useId();
  const rows = visible.filter((q) => !CHROME.has(q.type));

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {question.title}
      </h1>
      {question.subtitle && <p className="psw-subtitle">{question.subtitle}</p>}

      <dl className="psw-review" aria-labelledby={labelId}>
        {rows.map((q) => {
          const value = formatAnswer(answers[q.id]);
          return (
            <div key={q.id} className="psw-review-row">
              <dt className="psw-review-q">{titleOf(q, answers)}</dt>
              <dd className="psw-review-a">
                <span className={value === '' ? 'psw-review-empty' : undefined}>
                  {value === '' ? 'Not answered' : value}
                </span>
                <button
                  type="button"
                  className="psw-review-edit"
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

      <div className="psw-actions">
        <button type="button" className="psw-ok-btn" onClick={onAdvance}>
          {question.cta ?? 'Looks good'} <span aria-hidden>✓</span>
        </button>
        <span className="psw-hint">
          press <strong>Enter ↵</strong>
        </span>
      </div>
    </div>
  );
}
