'use client';

import type { WelcomeQuestion } from '@/types/Question.js';

type Props = {
  question: WelcomeQuestion;
  advance: () => void;
};

export function WelcomeScreen({ question, advance }: Props) {
  return (
    <div>
      <h1 className="psw-title">{question.title}</h1>
      {question.subtitle && <p className="psw-subtitle">{question.subtitle}</p>}
      <button type="button" className="psw-cta" onClick={advance}>
        {question.cta ?? 'Start'}
        <span className="psw-cta-hint">press Enter ↵</span>
      </button>
    </div>
  );
}
