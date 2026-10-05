/**
 * Password gate for a locked public form (ADR-043). A respondent screen:
 * form name, one field, Continue. No studio chrome, no way "back" to anything.
 */

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GATE_OFFLINE, WRONG_PASSWORD } from '../fillCopy.js';

type Props = {
  formName: string;
  /** Resolve with an error line to show, or null when unlocked. */
  onUnlock: (password: string) => Promise<string | null>;
};

export function FillGate({ formName, onUnlock }: Props) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    let message: string | null;
    try {
      message = await onUnlock(password);
    } catch (err) {
      // Never stuck on "Checking…" (COPY-11): whatever went wrong, say so and let them retry.
      console.error('[slate] unlock failed', err);
      message = GATE_OFFLINE;
    }
    if (message === null) return; // parent swaps in the form
    setBusy(false);
    setError(message);
    // A wrong password is cleared for the next try; after a network blip it stays.
    if (message === WRONG_PASSWORD) setPassword('');
    inputRef.current?.focus();
  };

  return (
    <main className="slate-fill-gate">
      <form
        className="slate-fill-gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="slate-fill-gate-title">{formName}</h1>
        <label className="slate-fill-gate-label" htmlFor={inputId}>
          Enter the password to continue
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="slate-input slate-fill-gate-input"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            // Some in-app webviews skip implicit form submit on Enter — don't rely on it.
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
          maxLength={72}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          // A shared word for a flyer, not a login — keep password managers out of the way.
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <p id={errorId} className="slate-fill-gate-error" role="alert">
          {error}
        </p>
        <button
          type="submit"
          className="slate-btn slate-btn--primary slate-fill-gate-submit"
          disabled={busy || !password}
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
