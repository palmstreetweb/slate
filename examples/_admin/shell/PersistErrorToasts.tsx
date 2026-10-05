/**
 * One place that tells the owner when a save didn't reach the cloud.
 * Before this only the editor listened, so a failed trash on the Dashboard or
 * Responses page looked done and quietly reverted (login check, 2026-09-23).
 *
 * The event carries owner copy only (neonError.ts → userNeonError): `message`
 * says what to do, and an optional `title` says what didn't happen.
 */

import { useEffect, useRef } from 'react';
import { useToast } from '../toast.js';

const REPEAT_MS = 4000;
const PLAIN_FALLBACK = 'Check your connection and try again.';

/**
 * Last line of defense: a sender that forgot to word its error must not put
 * a stack trace, a Postgres sentence or a status page in front of an owner.
 */
export function looksTechnical(message: string): boolean {
  return /TypeError|Error:|<\/?[a-z!]|PGRST|\d{5}\b|\bat \S+:\d+|\{\s*"|violates|constraint|JWT|row-level|undefined|NaN/.test(
    message,
  );
}

const TITLES: Record<string, string> = {
  form: 'Couldn’t save your form',
  submission: 'Couldn’t update that response',
};

export function PersistErrorToasts() {
  const toast = useToast();
  const last = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; message?: string; title?: string }>)
        .detail;
      const kind = detail?.kind ?? 'form';
      const sent = detail?.message?.trim() ?? '';
      if (sent && looksTechnical(sent)) console.error('[slate] unworded persist error:', sent);
      const message = sent && !looksTechnical(sent) ? sent : PLAIN_FALLBACK;
      const title = detail?.title || (TITLES[kind] ?? 'Couldn’t save');
      // A burst of queued writes failing together is one problem, not five toasts.
      const key = `${kind}:${title}:${message}`;
      const now = Date.now();
      if (last.current && last.current.key === key && now - last.current.at < REPEAT_MS) return;
      last.current = { key, at: now };
      toast.push({
        title,
        detail: message,
        tone: 'error',
      });
    };
    window.addEventListener('slate-persist-error', onError);
    return () => window.removeEventListener('slate-persist-error', onError);
  }, [toast]);

  return null;
}
