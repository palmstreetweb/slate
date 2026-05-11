'use client';

import type { ThanksQuestion } from '@/types/Question.js';

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

type Props = {
  question: ThanksQuestion;
  status: SubmitStatus;
  error: string | null;
  onRetry: () => void;
  onRestart: () => void;
};

export function ThanksScreen({ question, status, error, onRetry, onRestart }: Props) {
  return (
    <div>
      <h1 className="psw-title">{question.title}</h1>
      {question.subtitle && <p className="psw-subtitle">{question.subtitle}</p>}

      <div style={{ marginTop: 24 }}>
        {status === 'submitting' && (
          <div
            aria-live="polite"
            className="psw-hint"
            style={{ fontSize: 13, opacity: 0.65 }}
          >
            submitting...
          </div>
        )}

        {status === 'success' && (
          <div aria-live="polite" className="psw-confirm-chip">
            ✓ confirmation sent
          </div>
        )}

        {status === 'error' && (
          <div aria-live="polite">
            <p className="psw-err">{error ?? 'Something went wrong.'}</p>
            <button type="button" className="psw-ok-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        {question.cta && status === 'success' && (
          <button
            type="button"
            onClick={onRestart}
            style={{
              display: 'block',
              marginTop: 24,
              fontSize: 14,
              textDecoration: 'underline',
              opacity: 0.6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--psw-font-body)',
              color: 'var(--psw-text)',
              textTransform: 'var(--psw-transform)' as 'lowercase' | 'none',
              padding: 0,
            }}
          >
            {question.cta}
          </button>
        )}
      </div>
    </div>
  );
}
