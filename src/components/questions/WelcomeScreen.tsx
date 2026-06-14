'use client';

import type { WelcomeQuestion } from '@/types/Question.js';

type Props = {
  question: WelcomeQuestion;
  advance: () => void;
};

export function WelcomeScreen({ question, advance }: Props) {
  return (
    <div>
      <h1 className="slate-title">{question.title}</h1>
      {question.subtitle && <p className="slate-subtitle">{question.subtitle}</p>}
      <button type="button" className="slate-cta" onClick={advance}>
        {question.cta ?? 'Start'}
        <span className="slate-cta-hint">press Enter ↵</span>
      </button>
    </div>
  );
}
