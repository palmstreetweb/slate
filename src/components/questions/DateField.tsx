/**
 * Date input — three segmented native text inputs (month / day / year,
 * ordered per `question.format`) instead of a date-picker dependency.
 * See DECISIONS.md ADR-010. Stored as ISO `YYYY-MM-DD`.
 *
 * Typing follows `logic/dateEntry.ts`: "3/7/2026" or a pasted "10/03/2026"
 * fills the boxes, a 2-digit year is this century, and a partly filled or
 * impossible date says what to fix in the form's own order.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DateQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { buildIsoDate, fullYear, splitTypedDate, typedBox, type DateBoxes } from '@/logic/dateEntry.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { shakeInvalid } from '@/utils/motion.js';
import { focusAfter } from '@/utils/focus.js';
import { FieldError } from './ext/fieldMessage.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: DateQuestion;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
};

function parseIso(iso: string): DateBoxes {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { month: '', day: '', year: '' };
  return { year: m[1]!, month: m[2]!, day: m[3]! };
}

export function DateField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [seg, setSeg] = useState<DateBoxes>(() => parseIso(initialValue));
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const errId = `${labelId}-err`;
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const format = question.format ?? 'MM/DD/YYYY';
  const firstRef = format === 'MM/DD/YYYY' ? monthRef : dayRef;

  useEffect(() => {
    return focusAfter(firstRef.current);
  }, [question.id, firstRef]);

  const setPart = (
    part: keyof DateBoxes,
    raw: string,
    nextRef?: React.RefObject<HTMLInputElement | null>,
  ) => {
    if (error) setError(null);
    // A whole date typed or pasted into one box fills all three.
    const whole = splitTypedDate(raw, format);
    if (whole) {
      setSeg(whole);
      yearRef.current?.focus();
      return;
    }
    const { digits, done } = typedBox(part, raw);
    setSeg((s) => ({ ...s, [part]: digits }));
    if (done) nextRef?.current?.focus();
  };

  const submit = useCallback(() => {
    let iso = '';
    if (seg.month || seg.day || seg.year) {
      const built = buildIsoDate(seg, format);
      if ('error' in built) {
        setError(built.error);
        shakeInvalid(rowRef.current);
        return;
      }
      iso = built.date;
      // Show the year as it is read: "26" becomes 2026.
      setSeg((s) => ({ ...s, year: fullYear(s.year) }));
    }
    const err = validate(question, iso);
    if (err) {
      setError(err.message);
      shakeInvalid(rowRef.current);
      return;
    }
    setError(null);
    onAnswer(iso);
    onAdvance();
  }, [question, seg, format, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const box = (
    part: keyof DateBoxes,
    ref: React.RefObject<HTMLInputElement | null>,
    placeholder: string,
    label: string,
    next?: React.RefObject<HTMLInputElement | null>,
  ) => (
    <input
      key={part}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={seg[part]}
      onChange={(e) => setPart(part, e.target.value, next)}
      onKeyDown={handleKey}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={Boolean(error)}
      aria-describedby={errId}
      className={`slate-input slate-date-seg${part === 'year' ? ' slate-date-seg--year' : ''}${error ? ' slate-input--error' : ''}`}
    />
  );

  const sep = <span className="slate-date-sep" aria-hidden>/</span>;

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <div ref={rowRef} className="slate-date-row" role="group" aria-labelledby={labelId}>
          {format === 'MM/DD/YYYY' ? (
            <>
              {box('month', monthRef, 'MM', 'Month', dayRef)}
              {sep}
              {box('day', dayRef, 'DD', 'Day', yearRef)}
            </>
          ) : (
            <>
              {box('day', dayRef, 'DD', 'Day', monthRef)}
              {sep}
              {box('month', monthRef, 'MM', 'Month', yearRef)}
            </>
          )}
          {sep}
          {box('year', yearRef, 'YYYY', 'Year')}
        </div>
        <FieldError id={errId} error={error} />
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint">press Enter ↵</span>
        </div>
      </div>
    </div>
  );
}
