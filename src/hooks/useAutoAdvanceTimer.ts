import { useCallback, useEffect, useRef } from 'react';

/**
 * Schedules a one-shot auto-advance (single-choice pause, etc.). Clears any
 * pending timer when the question changes or the hook unmounts so Back within
 * the delay window cannot ghost-advance.
 */
export function useAutoAdvanceTimer(questionId: string | undefined) {
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (fn: () => void, ms = 220) => {
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        fn();
      }, ms);
    },
    [clear],
  );

  useEffect(() => {
    clear();
    return clear;
  }, [questionId, clear]);

  return { schedule, clear };
}
