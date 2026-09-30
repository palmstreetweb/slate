/**
 * A response's instant estimate (ADR-064), in both views: the range as a fact
 * and, when there is more than one priced answer, the lines that make it up.
 * The figure is the submit Function's own (recomputed from the published
 * prices), so it matches what the respondent saw. Text only.
 */

'use client';

import type { Estimate } from '@/index.js';
import { estimateFraction, formatEstimate, formatMoneyRange } from '@/logic/estimate.js';

/** "$2,400 – $3,100". */
export function estimateLabel(e: Estimate): string {
  return formatEstimate(e);
}

export function EstimateBreakdown({ estimate }: { estimate: Estimate }) {
  if (estimate.lines.length < 2) return null;
  const fraction = estimateFraction(estimate);
  return (
    <ul className="rsp-estimate-lines" aria-label="How the estimate adds up">
      {estimate.lines.map((line, i) => (
        <li key={`${line.id}-${i}`}>
          <span className="rsp-estimate-line-label" dir="auto">
            {line.label}
            {line.qty !== undefined ? (
              <span className="rsp-estimate-qty"> × {line.qty}</span>
            ) : null}
          </span>
          <span className="rsp-estimate-line-amount">
            {formatMoneyRange(line.low, line.high, estimate.currency, fraction)}
          </span>
        </li>
      ))}
    </ul>
  );
}
