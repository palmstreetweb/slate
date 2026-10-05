/**
 * OK / Skip for questions answered with one tap: the numbers scale, NPS,
 * legal consent, stars and faces. A tap still answers and moves on
 * by itself; this row is for moving on without one. An optional question
 * shows Skip, a required one says what to do when Enter is pressed, and one
 * already answered (after Back) shows OK to keep the answer as it is.
 * On demand only, like the fields that use it.
 *
 * Enter waits until the question has been up for a moment: a double Enter
 * from the question before would otherwise skip this one before anyone saw
 * it (QA). A held Enter (key repeat) never confirms anything (useKeyboardNav).
 */

'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { FieldError } from './fieldMessage.js';

/** How long a question is up before Enter can skip or confirm it. */
const ENTER_WAIT_MS = 500;

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
  const shownAt = useRef(Date.now());

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

  const enter = useCallback(() => {
    if (Date.now() - shownAt.current < ENTER_WAIT_MS) return;
    go();
  }, [go]);

  useRegisterFormConfirm(enter);

  return (
    <>
      <FieldError id={errorId} error={error} />
      <div ref={rowRef} className="slate-actions">
        {answered || !required ? (
          <button
            type="button"
            // Skip is the quiet, outlined button the choice questions use; OK is the main one.
            className={answered ? 'slate-ok-btn' : 'slate-ok-btn slate-ok-btn--skip'}
            onClick={go}
          >
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
