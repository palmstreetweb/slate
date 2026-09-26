import { createContext, useContext, useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Internal override for previews (ADR-059). `null` follows the OS setting;
 * `true` / `false` force calm or full motion for every form below it. The
 * examples motion gallery uses it for its "Reduce motion" switch. Not part
 * of the public API — hosts should rely on the respondent's OS setting.
 */
export const ReducedMotionOverrideContext = createContext<boolean | null>(null);

/**
 * Reactive `prefers-reduced-motion` flag. Returns `false` during SSR.
 * Updates if the OS-level setting changes mid-session.
 */
export function useReducedMotion(): boolean {
  const override = useContext(ReducedMotionOverrideContext);
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return override ?? reduced;
}
