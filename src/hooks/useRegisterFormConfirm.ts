'use client';

import { createContext, useContext, useEffect, type MutableRefObject } from 'react';

export const FormConfirmRefContext = createContext<MutableRefObject<(() => void) | null> | null>(
  null,
);

/** Register this step's OK/submit handler so global Enter works from any focus. */
export function useRegisterFormConfirm(fn: () => void, enabled = true): void {
  const ref = useContext(FormConfirmRefContext);
  useEffect(() => {
    if (!ref || !enabled) return undefined;
    ref.current = fn;
    return () => {
      if (ref.current === fn) ref.current = null;
    };
  }, [ref, fn, enabled]);
}
