/**
 * Phone input. Stores E.164. The libphonenumber-js dependency is dynamically
 * imported inside this file (per ADR-006) so consumers who never use phone
 * questions don't pay for the parser bundle.
 */

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { PhoneQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { focusAfter } from '@/utils/focus.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: PhoneQuestion;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
};

// Type-only import is fully erased by TS, so the runtime bundle stays free
// of libphonenumber-js until the dynamic import() below actually fires.
import type * as Libphonenumber from 'libphonenumber-js';

let libCache: typeof Libphonenumber | null = null;

async function loadLib(): Promise<typeof Libphonenumber> {
  if (libCache) return libCache;
  libCache = await import('libphonenumber-js');
  return libCache;
}

export function PhoneField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = async () => {
    // Engine-level required check first (cheap).
    const presence = validate(question, value);
    if (presence) {
      setError(presence.message);
      return;
    }
    if (!value.trim() && !question.required) {
      onAnswer('');
      onAdvance();
      return;
    }

    try {
      const lib = await loadLib();
      // libphonenumber-js types accept a string country code; cast it to its
      // CountryCode union without bringing the type into the public surface.
      const country = (question.defaultCountry ?? 'US') as Parameters<
        typeof lib.parsePhoneNumberFromString
      >[1];
      const parsed = lib.parsePhoneNumberFromString(value, country);
      if (!parsed || !parsed.isValid()) {
        setError("That doesn't look like a valid phone number");
        return;
      }
      setError(null);
      onAnswer(parsed.number);
      onAdvance();
    } catch {
      setError('Could not parse that phone number');
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div>
      <h1 id={labelId} className="psw-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <input
          ref={inputRef}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          placeholder={question.placeholder ?? '(555) 123-4567'}
          aria-labelledby={labelId}
          aria-invalid={Boolean(error)}
          className={`psw-input${error ? ' psw-input--error' : ''}`}
        />
        {error && (
          <p className="psw-err" aria-live="polite">
            ! {error}
          </p>
        )}
        <div className="psw-actions">
          <button type="button" className="psw-ok-btn" onClick={() => void submit()}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="psw-hint">press Enter ↵</span>
        </div>
      </div>
    </div>
  );
}
