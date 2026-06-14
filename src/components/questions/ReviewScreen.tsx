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
      <h1 id={labelId} className="slate-title">
        {question.title}
      </h1>
      {question.subtitle && <p className="slate-subtitle">{question.subtitle}</p>}

      <dl className="slate-review" aria-labelledby={labelId}>
        {rows.map((q) => {
          const value = formatAnswer(answers[q.id]);
          return (
            <div key={q.id} className="slate-review-row">
              <dt className="slate-review-q">{titleOf(q, answers)}</dt>
              <dd className="slate-review-a">
                <span className={value === '' ? 'slate-review-empty' : undefined}>
                  {value === '' ? 'Not answered' : value}
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
        <span className="slate-hint">
          press <strong>Enter ↵</strong>
        </span>
      </div>
    </div>
  );
}
