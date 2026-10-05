/**
 * One place that tells the owner when a save didn't reach the cloud.
 * Before this only the editor listened, so a failed trash on the Dashboard or
 * Responses page looked done and quietly reverted (login check, 2026-09-23).
 */

import { useEffect, useRef } from 'react';
import { useToast } from '../toast.js';

const REPEAT_MS = 4000;
const PUBLISH_KEY = 'form:publish';

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
      const recent = last.current !== null && now - last.current.at < REPEAT_MS;
      if (recent && last.current!.key === key) return;
      // A failed publish has just said so; its save error is the same problem (COPY-10).
      if (recent && kind === 'form' && last.current!.key === PUBLISH_KEY) return;
      last.current = { key, at: now };
      toast.push({
        title: TITLES[kind] ?? 'Couldn’t save',
        detail: message,
        tone: 'error',
      });
    };
    // A publish whose write never landed: the form isn't live, whatever was shown.
    // Never folded into an earlier save error — it's news even right after one.
    const onPublishError = () => {
      last.current = { key: PUBLISH_KEY, at: Date.now() };
      toast.push({
        title: 'Couldn’t publish',
        detail: 'Your form isn’t live yet. Check your connection and try again.',
        tone: 'error',
      });
    };
    window.addEventListener('slate-persist-error', onError);
    window.addEventListener('slate-publish-error', onPublishError);
    return () => {
      window.removeEventListener('slate-persist-error', onError);
      window.removeEventListener('slate-publish-error', onPublishError);
    };
  }, [toast]);

  return null;
}
