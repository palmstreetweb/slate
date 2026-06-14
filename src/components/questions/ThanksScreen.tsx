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
      <h1 className="slate-title">{question.title}</h1>
      {question.subtitle && <p className="slate-subtitle">{question.subtitle}</p>}

      <div style={{ marginTop: 24 }}>
        {status === 'submitting' && (
          <div
            aria-live="polite"
            className="slate-hint"
            style={{ fontSize: 13, opacity: 0.65 }}
          >
            submitting...
          </div>
        )}

        {status === 'success' && (
          <div aria-live="polite" className="slate-confirm-chip">
            ✓ confirmation sent
          </div>
        )}

        {status === 'error' && (
          <div aria-live="polite">
            <p className="slate-err">{error ?? 'Something went wrong.'}</p>
            <button type="button" className="slate-ok-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        {status === 'success' && (
          <button
            type="button"
            onClick={onRestart}
            style={{
              display: 'block',
              marginTop: 24,
              fontSize: 14,
              textDecoration: 'underline',
              opacity: 0.7,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--slate-font-body)',
              color: 'var(--slate-text)',
              textTransform: 'var(--slate-transform)' as 'lowercase' | 'none',
              padding: 0,
            }}
          >
            {question.cta ?? 'Submit another'}
          </button>
        )}
      </div>
    </div>
  );
}
