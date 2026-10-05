/**
 * Contact block (ADR-064): name, email and phone on one screen, as one
 * question. Loaded on demand.
 *
 * Built for one-tap autofill: the inputs sit in a real <form> with the
 * standard `name` / `email` / `tel` autocomplete tokens, input types and
 * keyboards, so iOS offers the respondent's own card above the keyboard and
 * fills every part at once. Enter moves to the next part, then submits.
 * Phone numbers are stored as E.164 when they parse (libphonenumber-js, the
 * same lazy import as the phone question, ADR-006).
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ContactField, ContactInfoQuestion } from '@/types/Question.js';
import type * as Libphonenumber from 'libphonenumber-js';
import { CONTACT_MAX, contactErrors, contactMode, contactShown } from '@/logic/contact.js';
import { phoneCountry, phoneProblem } from '@/logic/phoneText.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';

let libCache: typeof Libphonenumber | null = null;
async function loadPhoneLib(): Promise<typeof Libphonenumber> {
  if (!libCache) libCache = await import('libphonenumber-js');
  return libCache;
}

const LABEL: Record<ContactField, string> = { name: 'Name', email: 'Email', phone: 'Phone' };
const PLACEHOLDER: Record<ContactField, string> = {
  name: 'Jane Smith',
  email: 'name@example.com',
  phone: '(805) 555-0100',
};

type Texts = Record<ContactField, string>;

function seed(value: unknown): Texts {
  const v =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  return { name: s('name'), email: s('email'), phone: s('phone') };
}

export default function ContactInfoField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
}: ExtFieldProps<ContactInfoQuestion>) {
  const titleId = useId();
  const shown = contactShown(question);
  const [texts, setTexts] = useState<Texts>(() => seed(value));
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});
  const refs = useRef<Partial<Record<ContactField, HTMLInputElement | null>>>({});
  const busy = useRef(false);

  const first = shown[0];
  useEffect(() => focusAfter(first ? (refs.current[first] ?? null) : null), [question.id, first]);

  const submit = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const trimmed: Partial<Texts> = {};
      for (const f of shown) {
        const t = texts[f].trim();
        if (t) trimmed[f] = t;
      }
      const found = contactErrors(question, trimmed);
      // Local numbers read in the owner's country, or the US when that isn't a real one.
      let country = phoneCountry(question.defaultCountry, () => true);
      // A phone that parses is stored as E.164; one that doesn't is an error.
      if (trimmed.phone && !found.phone) {
        try {
          const lib = await loadPhoneLib();
          country = phoneCountry(question.defaultCountry, (c) => lib.isSupportedCountry(c));
          const parsed = lib.parsePhoneNumberFromString(
            trimmed.phone,
            country as Libphonenumber.CountryCode,
          );
          if (parsed?.isValid()) trimmed.phone = parsed.number;
          else found.phone = phoneProblem(country);
        } catch (err) {
          // Offline and the parser didn't load: keep what they typed.
          console.error('[slate] phone check unavailable', err);
        }
      } else if (trimmed.phone && found.phone && trimmed.phone.length <= CONTACT_MAX.phone) {
        // Too few digits: the same words as the phone question.
        found.phone = phoneProblem(country);
      }
      const bad = shown.find((f) => found[f]);
      if (bad) {
        setErrors(found);
        const el = refs.current[bad] ?? null;
        shakeInvalid(el);
        el?.focus();
        return;
      }
      setErrors({});
      onAnswer(Object.keys(trimmed).length ? trimmed : undefined);
      onAdvance();
    } finally {
      busy.current = false;
    }
  }, [shown, texts, question, onAnswer, onAdvance]);

  const confirm = useCallback(() => {
    void submit();
  }, [submit]);
  useRegisterFormConfirm(confirm);

  const onKeyDown = (f: ContactField) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (isTypewriterKey(e)) onType?.();
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    // A held Enter (key repeat) never runs through the parts and confirms (ENG-07).
    if (e.repeat) return;
    const next = shown[shown.indexOf(f) + 1];
    if (next) refs.current[next]?.focus();
    else confirm();
  };

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <form
        className="slate-parts slate-contact"
        aria-labelledby={titleId}
        autoComplete="on"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        {shown.map((f, i) => {
          const optional = contactMode(question, f) === 'optional';
          const err = errors[f];
          const errId = `${titleId}-${f}-err`;
          return (
            <label key={f} className="slate-part" style={{ '--slate-i': i } as React.CSSProperties}>
              <span className="slate-part-label">
                {LABEL[f]}
                {optional ? <span className="slate-part-optional"> (optional)</span> : null}
              </span>
              <input
                ref={(el) => {
                  refs.current[f] = el;
                }}
                className={`slate-input slate-part-input${err ? ' slate-input--error' : ''}`}
                name={f === 'phone' ? 'tel' : f}
                type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
                inputMode={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
                autoComplete={f === 'phone' ? 'tel' : f}
                autoCapitalize={f === 'name' ? 'words' : 'off'}
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint={i === shown.length - 1 ? 'done' : 'next'}
                maxLength={CONTACT_MAX[f]}
                placeholder={PLACEHOLDER[f]}
                value={texts[f]}
                required={!optional}
                aria-invalid={Boolean(err)}
                aria-describedby={err ? errId : undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setTexts((t) => ({ ...t, [f]: next }));
                  if (err) setErrors((cur) => ({ ...cur, [f]: undefined }));
                }}
                onKeyDown={onKeyDown(f)}
              />
              {err ? (
                <span id={errId} className="slate-err slate-part-err" aria-live="polite">
                  {err}
                </span>
              ) : null}
            </label>
          );
        })}
      </form>
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={confirm}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-keys">press Enter ↵</span>
      </div>
    </div>
  );
}
