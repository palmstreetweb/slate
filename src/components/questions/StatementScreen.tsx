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
      <h1 className="slate-title">{question.title}</h1>
      {question.body && <p className="slate-subtitle">{question.body}</p>}
      <button type="button" className="slate-cta" onClick={advance}>
        {question.cta ?? 'Continue'}
        <span className="slate-cta-hint">press Enter ↵</span>
      </button>
    </div>
  );
}
