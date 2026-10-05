'use client';

import { createContext, useContext, useEffect, useState, type MutableRefObject } from 'react';

export const FormConfirmRefContext = createContext<MutableRefObject<(() => void) | null> | null>(
  null,
);

/**
 * Register this step's OK/submit handler so global Enter works from any focus.
 * With `wait`, Enter does nothing until the field has been up that long (ms):
 * a Skip on Enter must not catch the double Enter that confirmed the question
 * before, before anyone saw this one (QA retest).
 */
export function useRegisterFormConfirm(fn: () => void, enabled = true, wait = 0): void {
  const ref = useContext(FormConfirmRefContext);
  const [shown] = useState(Date.now);
  useEffect(() => {
    if (!ref || !enabled) return undefined;
    const go = () => Date.now() - shown < wait || fn();
    ref.current = go;
    return () => {
      if (ref.current === go) ref.current = null;
    };
  }, [ref, fn, enabled, wait, shown]);
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
