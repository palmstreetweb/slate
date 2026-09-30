'use client';

import { Component, Suspense, type CSSProperties, type ReactNode } from 'react';
import type { ThanksQuestion } from '@/types/Question.js';
import type { Estimate, EstimateSettings } from '@/types/Estimate.js';
import { useReducedMotion } from '@/hooks/useReducedMotion.js';
import { formatEstimate } from '@/logic/estimate.js';
import { estimateRevealComponent } from './lazyFields.js';

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

type Props = {
  question: ThanksQuestion;
  status: SubmitStatus;
  error: string | null;
  onRetry: () => void;
  onRestart: () => void;
  /** The instant estimate to reveal once the response is received (ADR-064). */
  estimate?: Estimate | null;
  estimateSettings?: EstimateSettings;
};

/** The estimate as one plain line: while the reveal loads, or if it can't. */
function EstimateText({ estimate, settings }: { estimate: Estimate; settings?: EstimateSettings }) {
  return (
    <p className="slate-estimate-plain">
      {(settings?.label?.trim() || 'Your estimate') + ': '}
      <strong>{formatEstimate(estimate)}</strong>
    </p>
  );
}

/** A reveal chunk that can't download falls back to the plain line, never a blank. */
class RevealBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Burst layout for the completion celebration (ADR-059): 14 pieces fanned
 * over the upper half-circle around the chip. Fixed, not random, so every
 * respondent sees the same composed burst and snapshots stay stable. Shape
 * and colour come from motion.css per theme.
 */
const CONFETTI: ReadonlyArray<{ x: number; y: number; r: number; d: number }> = [
  { x: -150, y: -58, r: 220, d: 0 },
  { x: -118, y: -104, r: -160, d: 30 },
  { x: -84, y: -136, r: 300, d: 10 },
  { x: -46, y: -158, r: -240, d: 50 },
  { x: -12, y: -120, r: 180, d: 20 },
  { x: 22, y: -166, r: -300, d: 40 },
  { x: 58, y: -140, r: 260, d: 0 },
  { x: 94, y: -112, r: -200, d: 60 },
  { x: 132, y: -80, r: 320, d: 20 },
  { x: 164, y: -44, r: -140, d: 40 },
  { x: -176, y: -12, r: 160, d: 70 },
  { x: 188, y: -6, r: -260, d: 80 },
  { x: -70, y: -70, r: 120, d: 90 },
  { x: 80, y: -64, r: -120, d: 100 },
];

function Confetti() {
  return (
    <span className="slate-confetti" aria-hidden="true">
      {CONFETTI.map((p, i) => (
        <i
          key={i}
          className="slate-confetti-piece"
          style={
            {
              '--slate-cf-x': `${p.x}px`,
              '--slate-cf-y': `${p.y}px`,
              '--slate-cf-r': `${p.r}deg`,
              '--slate-cf-delay': `${p.d}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

export function ThanksScreen({
  question,
  status,
  error,
  onRetry,
  onRestart,
  estimate,
  estimateSettings,
}: Props) {
  const reducedMotion = useReducedMotion();
  const Reveal = estimateRevealComponent();

  return (
    <div className="slate-thanks">
      <h1 className="slate-title">{question.title}</h1>
      {question.subtitle && <p className="slate-subtitle">{question.subtitle}</p>}

      {/* The estimate appears with the confirmation (ADR-064): the owner has it too. */}
      {status === 'success' && estimate ? (
        <RevealBoundary fallback={<EstimateText estimate={estimate} settings={estimateSettings} />}>
          <Suspense fallback={<EstimateText estimate={estimate} settings={estimateSettings} />}>
            <Reveal estimate={estimate} settings={estimateSettings} />
          </Suspense>
        </RevealBoundary>
      ) : null}

      {/* One persistent polite region, so the status change is announced
          (a region created together with its text often isn't). */}
      <div className="slate-thanks-status" aria-live="polite">
        {status === 'submitting' && (
          <p className="slate-hint slate-thanks-pending">submitting...</p>
        )}

        {status === 'success' && (
          <div className="slate-confirm">
            <span className="slate-confirm-chip">
              <svg
                className="slate-confirm-check"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>response received</span>
            </span>
            {/* Celebration only on a confirmed submit; calm motion keeps the static check. */}
            {!reducedMotion && <Confetti />}
          </div>
        )}

        {status === 'error' && <p className="slate-err">{error ?? 'Something went wrong.'}</p>}
      </div>

      {status === 'error' && (
        <button type="button" className="slate-ok-btn" onClick={onRetry}>
          Retry
        </button>
      )}

      {status === 'success' && (
        <button type="button" className="slate-thanks-restart" onClick={onRestart}>
          {question.cta ?? 'Submit another'}
        </button>
      )}
    </div>
  );
}
