/**
 * STEP 5 placeholder. Renders title + type badge + a "next" button so the
 * engine pipeline (state machine, transitions, keyboard, submit, theme) can
 * be exercised end-to-end before the per-type Field components land in
 * STEP 6. Once the real fields are written, this file becomes a discriminated
 * `switch` over `question.type` returning the right Field.
 */

'use client';

import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';

export type QuestionRendererProps = {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: LooseAnswers[string]) => void;
  advance: () => void;
  stepNumber: number;
  totalSteps: number;
  submitStatus: 'idle' | 'submitting' | 'success' | 'error';
  submitError: string | null;
  onRetrySubmit: () => void;
};

function resolveTitle(q: Question, answers: LooseAnswers): string {
  if ('title' in q) {
    const t = q.title as unknown;
    if (typeof t === 'function') return (t as (a: LooseAnswers) => string)(answers);
    if (typeof t === 'string') return t;
  }
  return '';
}

export function QuestionRenderer({
  question,
  answers,
  advance,
  stepNumber,
  totalSteps,
  submitStatus,
  submitError,
  onRetrySubmit,
}: QuestionRendererProps) {
  const title = resolveTitle(question, answers);
  const isChrome =
    question.type === 'welcome' ||
    question.type === 'thanks' ||
    question.type === 'statement';

  return (
    <div>
      {!isChrome && stepNumber > 0 && totalSteps > 0 && (
        <div className="psw-step-badge">
          <span>{String(stepNumber).padStart(2, '0')}</span>
          <span className="psw-step-sep">→</span>
        </div>
      )}

      <h1 className="psw-title">{title}</h1>

      {'subtitle' in question && question.subtitle && (
        <p className="psw-subtitle">{question.subtitle}</p>
      )}

      {/* STEP 5 placeholder body. STEP 6 swaps real fields in here. */}
      <div
        style={{
          marginTop: 24,
          fontFamily: 'var(--psw-font-mono)',
          fontSize: 12,
          letterSpacing: '0.12em',
          opacity: 0.5,
          textTransform: 'uppercase',
        }}
      >
        [{question.type}] · placeholder · step 6 brings real ui
      </div>

      {question.type === 'thanks' ? (
        <ThanksCta
          status={submitStatus}
          error={submitError}
          onRetry={onRetrySubmit}
        />
      ) : (
        <button
          type="button"
          onClick={advance}
          style={{
            marginTop: 32,
            padding: '12px 24px',
            background: 'var(--psw-text)',
            color: 'var(--psw-bg)',
            border: 'none',
            borderRadius: 'var(--psw-radius)',
            fontFamily: 'var(--psw-font-body)',
            fontWeight: 500,
            fontSize: 15,
            cursor: 'pointer',
            textTransform: 'var(--psw-transform)' as 'lowercase' | 'none',
          }}
        >
          {question.type === 'welcome'
            ? 'cta' in question && question.cta
              ? question.cta
              : 'Start'
            : 'Next →'}
        </button>
      )}
    </div>
  );
}

function ThanksCta({
  status,
  error,
  onRetry,
}: {
  status: QuestionRendererProps['submitStatus'];
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div style={{ marginTop: 24 }}>
      {status === 'submitting' && (
        <div
          aria-live="polite"
          style={{ fontSize: 13, opacity: 0.65, fontFamily: 'var(--psw-font-mono)' }}
        >
          submitting...
        </div>
      )}
      {status === 'success' && (
        <div
          aria-live="polite"
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            background: 'var(--psw-text)',
            color: 'var(--psw-bg)',
            borderRadius: 'var(--psw-radius)',
            fontSize: 11,
            letterSpacing: '0.18em',
            fontFamily: 'var(--psw-font-mono)',
            textTransform: 'uppercase',
          }}
        >
          ✓ confirmation sent
        </div>
      )}
      {status === 'error' && (
        <div aria-live="polite">
          <p style={{ color: 'var(--psw-error)', fontSize: 14, marginBottom: 12 }}>
            {error ?? 'Something went wrong.'}
          </p>
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: '8px 16px',
              background: 'var(--psw-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--psw-radius)',
              cursor: 'pointer',
              fontFamily: 'var(--psw-font-body)',
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
