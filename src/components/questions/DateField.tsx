/**
 * Date input — three segmented native text inputs (month / day / year,
 * ordered per `question.format`) instead of a date-picker dependency.
 * See DECISIONS.md ADR-010. Stored as ISO `YYYY-MM-DD`.
 */

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { DateQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { focusAfter } from '@/utils/focus.js';
import { resolveTitle } from './_resolveTitle.js';

type Props = {
  question: DateQuestion;
  answers: LooseAnswers;
  initialValue: string;
  onAnswer: (value: string) => void;
  onAdvance: () => void;
};

type Segments = { month: string; day: string; year: string };

function parseIso(iso: string): Segments {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { month: '', day: '', year: '' };
  return { year: m[1]!, month: m[2]!, day: m[3]! };
}

function toIso({ month, day, year }: Segments): string {
  if (!month && !day && !year) return '';
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function DateField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [seg, setSeg] = useState<Segments>(() => parseIso(initialValue));
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const format = question.format ?? 'MM/DD/YYYY';
  const firstRef = format === 'MM/DD/YYYY' ? monthRef : dayRef;

  useEffect(() => {
    return focusAfter(firstRef.current);
  }, [question.id, firstRef]);

  const setPart = (part: keyof Segments, raw: string, nextRef?: React.RefObject<HTMLInputElement | null>) => {
    const digits = raw.replace(/\D/g, '').slice(0, part === 'year' ? 4 : 2);
    setSeg((s) => ({ ...s, [part]: digits }));
    if (error) setError(null);
    const full = part === 'year' ? digits.length === 4 : digits.length === 2;
    if (full && nextRef?.current) nextRef.current.focus();
  };

  const submit = () => {
    const iso = toIso(seg);
    const err = validate(question, iso);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAnswer(iso);
    onAdvance();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const monthInput = (next?: React.RefObject<HTMLInputElement | null>) => (
    <input
      key="month"
      ref={monthRef}
      type="text"
      inputMode="numeric"
      value={seg.month}
      onChange={(e) => setPart('month', e.target.value, next)}
      onKeyDown={handleKey}
      placeholder="MM"
      aria-label="Month"
      aria-invalid={Boolean(error)}
      className={`slate-input slate-date-seg${error ? ' slate-input--error' : ''}`}
    />
  );

  const dayInput = (next?: React.RefObject<HTMLInputElement | null>) => (
    <input
      key="day"
      ref={dayRef}
      type="text"
      inputMode="numeric"
      value={seg.day}
      onChange={(e) => setPart('day', e.target.value, next)}
      onKeyDown={handleKey}
      placeholder="DD"
      aria-label="Day"
      aria-invalid={Boolean(error)}
      className={`slate-input slate-date-seg${error ? ' slate-input--error' : ''}`}
    />
  );

  const yearInput = (
    <input
      key="year"
      ref={yearRef}
      type="text"
      inputMode="numeric"
      value={seg.year}
      onChange={(e) => setPart('year', e.target.value)}
      onKeyDown={handleKey}
      placeholder="YYYY"
      aria-label="Year"
      aria-invalid={Boolean(error)}
      className={`slate-input slate-date-seg slate-date-seg--year${error ? ' slate-input--error' : ''}`}
    />
  );

  const sep = <span className="slate-date-sep" aria-hidden>/</span>;

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <div className="slate-date-row" role="group" aria-labelledby={labelId}>
          {format === 'MM/DD/YYYY' ? (
            <>
              {monthInput(dayRef)}
              {sep}
              {dayInput(yearRef)}
            </>
          ) : (
            <>
              {dayInput(monthRef)}
              {sep}
              {monthInput(yearRef)}
            </>
          )}
          {sep}
          {yearInput}
        </div>
        {error && (
          <p className="slate-err" aria-live="polite">
            ! {error}
          </p>
        )}
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
