/**
 * Phone input. Stores E.164. The libphonenumber-js dependency is dynamically
 * imported inside this file (per ADR-006) so consumers who never use phone
 * questions don't pay for the parser bundle.
 *
 * Local numbers are read in the owner's country, or the US when that isn't a
 * real one (F13). A number that doesn't check out gets one plain message,
 * shared with the contact block (logic/phoneText.ts). If the parser can't
 * download (a Wi-Fi blip), a number with enough digits is kept as typed —
 * as the contact block does — rather than blaming the number.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PhoneQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { looksLikePhone, phoneCountry, phoneProblem } from '@/logic/phoneText.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { focusAfter } from '@/utils/focus.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import { FieldError } from './ext/fieldMessage.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: PhoneQuestion;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
  onType?: () => void;
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

export function PhoneField({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
  onType,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const labelId = useId();
  const errId = `${labelId}-err`;

  useEffect(() => {
    return focusAfter(inputRef.current);
  }, [question.id]);

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const fail = (message: string) => {
      setError(message);
      shakeInvalid(inputRef.current);
    };
    try {
      // Engine-level required check first (cheap).
      const presence = validate(question, value);
      if (presence) return fail(presence.message);
      const typed = value.trim();
      if (!typed && !question.required) {
        onAnswer('');
        onAdvance();
        return;
      }

      let lib: typeof Libphonenumber;
      try {
        lib = await loadLib();
      } catch (err) {
        // Offline and the parser didn't load: keep a plausible number as typed.
        console.error('[slate] phone check unavailable', err);
        if (!looksLikePhone(typed)) {
          return fail(phoneProblem(phoneCountry(question.defaultCountry, () => true)));
        }
        setError(null);
        onAnswer(typed);
        onAdvance();
        return;
      }
      const country = phoneCountry(question.defaultCountry, (c) => lib.isSupportedCountry(c));
      const parsed = lib.parsePhoneNumberFromString(typed, country as Libphonenumber.CountryCode);
      if (!parsed || !parsed.isValid()) return fail(phoneProblem(country));
      setError(null);
      onAnswer(parsed.number);
      onAdvance();
    } finally {
      submittingRef.current = false;
    }
  }, [question, value, onAnswer, onAdvance]);

  useRegisterFormConfirm(() => {
    void submit();
  });

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isTypewriterKey(e)) onType?.();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div>
      <h1 id={labelId} className="slate-title">
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
          aria-describedby={errId}
          aria-invalid={Boolean(error)}
          className={`slate-input${error ? ' slate-input--error' : ''}`}
        />
        <FieldError id={errId} error={error} />
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={() => void submit()}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint">press Enter ↵</span>
        </div>
      </div>
    </div>
  );
}
