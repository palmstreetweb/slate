'use client';

import type { StatementQuestion } from '@/types/Question.js';

type Props = {
  question: StatementQuestion;
  advance: () => void;
  stepBadge: number;
  totalSteps: number;
};

export function StatementScreen({ question, advance }: Props) {
  return (
    <div>
      <h1 className="psw-title">{question.title}</h1>
      {question.body && <p className="psw-subtitle">{question.body}</p>}
      <button type="button" className="psw-cta" onClick={advance}>
        {question.cta ?? 'Continue'}
        <span className="psw-cta-hint">press Enter ↵</span>
      </button>
    </div>
  );
}
