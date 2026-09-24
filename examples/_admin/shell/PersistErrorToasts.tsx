/**
 * One place that tells the owner when a save didn't reach the cloud.
 * Before this only the editor listened, so a failed trash on the Dashboard or
 * Responses page looked done and quietly reverted (login check, 2026-09-23).
 */

import { useEffect, useRef } from 'react';
import { useToast } from '../toast.js';

const REPEAT_MS = 4000;

const TITLES: Record<string, string> = {
  form: 'Couldn’t save your form',
  submission: 'Couldn’t update that response',
};

export function PersistErrorToasts() {
  const toast = useToast();
  const last = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; message?: string }>).detail;
      const kind = detail?.kind ?? 'form';
      const message = detail?.message || 'Check your connection and try again.';
      // A burst of queued writes failing together is one problem, not five toasts.
      const key = `${kind}:${message}`;
      const now = Date.now();
      if (last.current && last.current.key === key && now - last.current.at < REPEAT_MS) return;
      last.current = { key, at: now };
      toast.push({
        title: TITLES[kind] ?? 'Couldn’t save',
        detail: message,
        tone: 'error',
      });
    };
    window.addEventListener('slate-persist-error', onError);
    return () => window.removeEventListener('slate-persist-error', onError);
  }, [toast]);

  return null;
}
