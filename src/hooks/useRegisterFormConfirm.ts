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

/**
 * The Other choice's letter key (ADR-063). The field owns the Other text box,
 * so it registers what the key does (open the box and focus it, or for a
 * multi-select, toggle it); `<Form>` calls it for the letter after the last
 * option.
 */
export const FormOtherRefContext = createContext<MutableRefObject<(() => void) | null> | null>(
  null,
);

export function useRegisterOtherKey(fn: () => void, enabled = true): void {
  const ref = useContext(FormOtherRefContext);
  useEffect(() => {
    if (!ref || !enabled) return undefined;
    ref.current = fn;
    return () => {
      if (ref.current === fn) ref.current = null;
    };
  }, [ref, fn, enabled]);
}
