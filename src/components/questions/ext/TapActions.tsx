/**
 * OK / Skip for questions answered with one tap: the numbers scale, NPS,
 * legal consent, stars and faces. A tap still answers and moves on
 * by itself; this row is for moving on without one. An optional question
 * shows Skip, a required one says what to do when Enter is pressed, and one
 * already answered (after Back) shows OK to keep the answer as it is.
 * On demand only, like the fields that use it.
 */

'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { FieldError } from './fieldMessage.js';

type Props = {
  /** Why the question can't move on yet (required and unanswered), or null. */
  check: () => string | null;
  answered: boolean;
  required: boolean;
  onAdvance: () => void;
  /** The options, shaken when the question can't move on. */
  target?: RefObject<Element | null>;
  /** Enter on an option that has keyboard focus picks it; true when it did. */
  pickFocused?: () => boolean;
  /** The message slot's id, for the options' aria-describedby. */
  errorId?: string;
  hint?: ReactNode;
};

export function TapActions({
  check,
  answered,
  required,
  onAdvance,
  target,
  pickFocused,
  errorId,
  hint,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // A pick answers the message.
  useEffect(() => {
    if (answered) setError(null);
  }, [answered]);

  const go = useCallback(() => {
    if (pickFocused?.()) return;
    const message = check();
    if (message) {
      setError(message);
      shakeInvalid(target?.current ?? rowRef.current);
      return;
    }
    onAdvance();
  }, [check, onAdvance, pickFocused, target]);

  useRegisterFormConfirm(go);

  return (
    <>
      <FieldError id={errorId} error={error} />
      <div ref={rowRef} className="slate-actions">
        {answered || !required ? (
          <button type="button" className="slate-ok-btn" onClick={go}>
            {answered ? (
              <>
                OK <span aria-hidden>✓</span>
              </>
            ) : (
              'Skip'
            )}
          </button>
        ) : null}
        {hint}
      </div>
    </>
  );
}
