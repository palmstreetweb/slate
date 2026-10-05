/**
 * Address (ADR-064): street, unit, city, state / region, ZIP / postal code and
 * an optional country, as one question. Loaded on demand.
 *
 * No lookup service (a paid key, held back): the parts use the standard
 * autofill tokens so the browser's saved address fills them in one tap.
 * With the unit line shown, the street is `address-line1` + `address-line2`;
 * without it, one `street-address` line (the two sets must not be mixed).
 * The country is free text, so it's `country-name`, not the code-only `country`.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AddressQuestion } from '@/types/Question.js';
import { ADDRESS_MAX, type AddressPart } from '@/logic/address.js';
import { addressErrors, addressNeeded, addressShown } from '@/logic/contact.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';

type Texts = Record<AddressPart, string>;

const EMPTY: Texts = { street: '', line2: '', city: '', region: '', postal: '', country: '' };

function seed(value: unknown): Texts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY;
  const v = value as Record<string, unknown>;
  const out = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as AddressPart[]) {
    if (typeof v[k] === 'string') out[k] = v[k] as string;
  }
  return out;
}

export default function AddressField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
}: ExtFieldProps<AddressQuestion>) {
  const titleId = useId();
  const us = (question.format ?? 'us') === 'us';
  const shown = addressShown(question);
  const needed = new Set(addressNeeded(question));
  const [texts, setTexts] = useState<Texts>(() => seed(value));
  const [errors, setErrors] = useState<Partial<Record<AddressPart, string>>>({});
  const refs = useRef<Partial<Record<AddressPart, HTMLInputElement | null>>>({});

  useEffect(() => focusAfter(refs.current.street ?? null), [question.id]);

  const meta: Record<
    AddressPart,
    { label: string; auto: string; placeholder: string; mode?: 'text' | 'numeric' }
  > = {
    street: {
      label: 'Street address',
      auto: shown.includes('line2') ? 'address-line1' : 'street-address',
      placeholder: '123 Palm St',
    },
    line2: { label: 'Apt, suite or unit', auto: 'address-line2', placeholder: 'Apt 4' },
    city: { label: 'City', auto: 'address-level2', placeholder: us ? 'Santa Barbara' : 'City' },
    region: {
      label: us ? 'State' : 'State / province / region',
      auto: 'address-level1',
      placeholder: us ? 'CA' : '',
    },
    postal: {
      label: us ? 'ZIP code' : 'Postal code',
      auto: 'postal-code',
      placeholder: us ? '93101' : '',
      mode: us ? 'numeric' : 'text',
    },
    country: { label: 'Country', auto: 'country-name', placeholder: us ? 'United States' : '' },
  };

  const submit = useCallback(() => {
    const trimmed: Partial<Texts> = {};
    for (const part of shown) {
      const t = texts[part].trim();
      if (t) trimmed[part] = part === 'postal' && !us ? t.toUpperCase() : t;
    }
    const found = addressErrors(question, trimmed);
    const bad = shown.find((p) => found[p]);
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
  }, [shown, texts, us, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const onKeyDown = (part: AddressPart) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (isTypewriterKey(e)) onType?.();
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const next = shown[shown.indexOf(part) + 1];
    if (next) refs.current[next]?.focus();
    else submit();
  };

  const input = (part: AddressPart, i: number) => {
    const m = meta[part];
    const err = errors[part];
    const errId = `${titleId}-${part}-err`;
    const optional = !needed.has(part);
    return (
      <label
        key={part}
        className={`slate-part slate-part--${part}`}
        style={{ '--slate-i': i } as React.CSSProperties}
      >
        <span className="slate-part-label">
          {m.label}
          {optional && (question.required || part === 'line2') ? (
            <span className="slate-part-optional"> (optional)</span>
          ) : null}
        </span>
        <input
          ref={(el) => {
            refs.current[part] = el;
          }}
          className={`slate-input slate-part-input${err ? ' slate-input--error' : ''}`}
          name={m.auto}
          type="text"
          inputMode={m.mode ?? 'text'}
          autoComplete={m.auto}
          autoCapitalize={part === 'postal' || part === 'region' ? 'characters' : 'words'}
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={i === shown.length - 1 ? 'done' : 'next'}
          maxLength={ADDRESS_MAX[part]}
          placeholder={m.placeholder}
          value={texts[part]}
          aria-invalid={Boolean(err)}
          aria-describedby={err ? errId : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setTexts((t) => ({ ...t, [part]: next }));
            if (err) setErrors((cur) => ({ ...cur, [part]: undefined }));
          }}
          onKeyDown={onKeyDown(part)}
        />
        {err ? (
          <span id={errId} className="slate-err slate-part-err" aria-live="polite">
            {err}
          </span>
        ) : null}
      </label>
    );
  };

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <form
        className="slate-parts slate-address"
        aria-labelledby={titleId}
        autoComplete="on"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {shown.map((part, i) => input(part, i))}
      </form>
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-keys">press Enter ↵</span>
      </div>
    </div>
  );
}
