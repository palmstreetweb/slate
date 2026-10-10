/**
 * Date with a time of day and/or a start–end range (ADR-063). Loaded on
 * demand; the plain date keeps its core field (DateField, ADR-010).
 *
 * Same segmented inputs as the plain date — no picker dependency — plus
 * hour : minute and, on month-first (US) forms, AM / PM. The meridiem follows
 * a business-hours guess (7–11 → AM, 12 and 1–6 → PM) until the respondent
 * picks one, and typing A or P sets it. Stored as an ISO string: see
 * `logic/dateValue.ts`.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { DateQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { isValidTime, parseDateAnswer, type DatePart } from '@/logic/dateValue.js';
import {
  buildIsoDate,
  dateAnswerToString,
  fullYear,
  splitTypedDate,
  typedBox,
  type DateFormat,
} from '@/logic/dateEntry.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import { FieldError } from './fieldMessage.js';
import '@/styles/extensions.css';

type Seg = 'month' | 'day' | 'year' | 'hour' | 'minute';
type PartState = {
  month: string;
  day: string;
  year: string;
  hour: string;
  minute: string;
  /** Explicit AM/PM pick; null follows the business-hours guess. */
  meridiem: 'AM' | 'PM' | null;
};

const EMPTY: PartState = { month: '', day: '', year: '', hour: '', minute: '', meridiem: null };

function fromPart(p: DatePart | undefined, clock12: boolean): PartState {
  if (!p) return EMPTY;
  const [year = '', month = '', day = ''] = p.date.split('-');
  if (!p.time) return { ...EMPTY, year, month, day };
  const [hh = '', minute = ''] = p.time.split(':');
  const h = Number(hh);
  if (!clock12) return { year, month, day, hour: hh, minute, meridiem: null };
  return {
    year,
    month,
    day,
    hour: String(h % 12 === 0 ? 12 : h % 12),
    minute,
    meridiem: h < 12 ? 'AM' : 'PM',
  };
}

/** 7–11 read as morning, 12 and 1–6 as afternoon: the hours people book things. */
function guessMeridiem(hour: string): 'AM' | 'PM' {
  const h = Number(hour);
  return h >= 7 && h <= 11 ? 'AM' : 'PM';
}

function meridiemOf(s: PartState): 'AM' | 'PM' {
  return s.meridiem ?? guessMeridiem(s.hour);
}

function isBlank(s: PartState, withTime: boolean): boolean {
  return !s.month && !s.day && !s.year && (!withTime || (!s.hour && !s.minute));
}

type Built = { part: DatePart } | { error: string };

function build(
  s: PartState,
  withTime: boolean,
  clock12: boolean,
  which: string,
  format: DateFormat,
): Built {
  // The date rules (and their words) are the plain date's: logic/dateEntry.ts.
  const d = buildIsoDate(s, format, which);
  if ('error' in d) return d;
  const { date } = d;
  if (!withTime) return { part: { date } };
  if (!s.hour || !s.minute) return { error: `Please add a time to the ${which}` };
  let h = Number(s.hour);
  if (clock12) {
    if (h < 1 || h > 12) return { error: 'Hours run from 1 to 12' };
    const pm = meridiemOf(s) === 'PM';
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) {
    return { error: 'Hours run from 0 to 23' };
  }
  if (Number(s.minute) > 59) return { error: 'Minutes run from 00 to 59' };
  const time = `${String(h).padStart(2, '0')}:${s.minute.padStart(2, '0')}`;
  if (!isValidTime(time)) return { error: "That doesn't look like a valid time" };
  return { part: { date, time } };
}

type PartProps = {
  idPrefix: string;
  state: PartState;
  onChange: (next: PartState) => void;
  format: DateFormat;
  withTime: boolean;
  clock12: boolean;
  invalid: boolean;
  /** The message slot, for each box's aria-describedby. */
  errId: string;
  /** Where each input registers itself, for focus hand-off. */
  register: (seg: Seg, el: HTMLInputElement | null) => void;
  /** Focus the input after `seg` (across parts). */
  onFilled: (seg: Seg) => void;
  onEnter: () => void;
};

function DateTimePart({
  idPrefix,
  state,
  onChange,
  format,
  withTime,
  clock12,
  invalid,
  errId,
  register,
  onFilled,
  onEnter,
}: PartProps) {
  const setSeg = (seg: Seg, raw: string) => {
    // A whole date typed or pasted into a date box fills the three of them.
    const whole = seg === 'hour' || seg === 'minute' ? null : splitTypedDate(raw, format);
    if (whole) {
      onChange({ ...state, ...whole });
      onFilled('year');
      return;
    }
    // Moves on at full length, after "/" or ":", or on a digit that can't start two.
    const { digits, done } = typedBox(seg, raw, clock12 ? 1 : 2);
    onChange({ ...state, [seg]: digits });
    if (done) onFilled(seg);
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // A held Enter (key repeat) never confirms (ADR-070, ENG-07).
      if (!e.repeat) onEnter();
      return;
    }
    // A plain A or P sets AM / PM; with a modifier it is the browser's own
    // (select all, print; audit 2026-10).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (clock12 && (e.key === 'a' || e.key === 'A' || e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      onChange({ ...state, meridiem: e.key.toUpperCase() === 'A' ? 'AM' : 'PM' });
    }
  };

  const seg = (name: Seg, placeholder: string, label: string, extra = '') => (
    <input
      key={name}
      ref={(el) => register(name, el)}
      type="text"
      inputMode="numeric"
      value={state[name]}
      onChange={(e) => setSeg(name, e.target.value)}
      onKeyDown={keyDown}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={errId}
      autoComplete="off"
      className={`slate-input slate-date-seg${extra}${invalid ? ' slate-input--error' : ''}`}
    />
  );
  const sep = (c: string) => (
    <span className="slate-date-sep" aria-hidden>
      {c}
    </span>
  );
  const month = seg('month', 'MM', 'Month');
  const day = seg('day', 'DD', 'Day');
  const meridiem = meridiemOf(state);

  return (
    <div className="slate-date-ext-part">
      <div className="slate-date-row">
        {format === 'MM/DD/YYYY' ? month : day}
        {sep('/')}
        {format === 'MM/DD/YYYY' ? day : month}
        {sep('/')}
        {seg('year', 'YYYY', 'Year', ' slate-date-seg--year')}
      </div>
      {withTime ? (
        <div className="slate-date-row slate-time-row">
          {seg('hour', clock12 ? 'HH' : 'hh', 'Hour')}
          {sep(':')}
          {seg('minute', 'MM', 'Minutes')}
          {clock12 ? (
            <span className="slate-meridiem" role="radiogroup" aria-label="AM or PM">
              {(['AM', 'PM'] as const).map((m) => (
                <button
                  key={m}
                  id={`${idPrefix}-${m}`}
                  type="button"
                  role="radio"
                  aria-checked={meridiem === m}
                  className={`slate-meridiem-btn${meridiem === m ? ' slate-meridiem-btn--on' : ''}`}
                  onClick={() => onChange({ ...state, meridiem: m })}
                >
                  {m}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function DateExtField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
}: ExtFieldProps<DateQuestion>) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const idPrefix = useId();
  const format = question.format ?? 'MM/DD/YYYY';
  const clock12 = format === 'MM/DD/YYYY';
  const withTime = question.includeTime === true;
  const range = question.range === true;
  const [parts, setParts] = useState<[PartState, PartState]>(() => {
    const parsed = parseDateAnswer(value);
    return [fromPart(parsed?.start, clock12), fromPart(parsed?.end, clock12)];
  });
  const [error, setError] = useState<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  /** Focus order across both parts. */
  const order: string[] = [];
  for (const p of range ? [0, 1] : [0]) {
    const date: Seg[] =
      format === 'MM/DD/YYYY' ? ['month', 'day', 'year'] : ['day', 'month', 'year'];
    for (const s of withTime ? [...date, 'hour' as const, 'minute' as const] : date) {
      order.push(`${p}:${s}`);
    }
  }

  // Focus the first segment once per question, like every field (brief §10.5).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => focusAfter(inputs.current.get(order[0]!) ?? null), [question.id]);

  const setPart = (i: 0 | 1, next: PartState) => {
    setParts((cur) => (i === 0 ? [next, cur[1]] : [cur[0], next]));
    if (error) setError(null);
  };

  const submit = useCallback(() => {
    const [a, b] = parts;
    const fail = (msg: string) => {
      setError(msg);
      shakeInvalid(groupRef.current);
    };
    let stored = '';
    if (!(isBlank(a, withTime) && (!range || isBlank(b, withTime)))) {
      const start = build(a, withTime, clock12, range ? 'start date' : 'date', format);
      if ('error' in start) return fail(start.error);
      if (range) {
        if (isBlank(b, withTime)) return fail('Please add an end date');
        const end = build(b, withTime, clock12, 'end date', format);
        if ('error' in end) return fail(end.error);
        stored = dateAnswerToString({ start: start.part, end: end.part });
      } else {
        stored = dateAnswerToString({ start: start.part });
      }
      // Show the years as they are read: "26" becomes 2026.
      setParts(([x, y]) => [
        { ...x, year: fullYear(x.year) },
        { ...y, year: fullYear(y.year) },
      ]);
    }
    const err = validate(question, stored);
    if (err) return fail(err.message);
    setError(null);
    onAnswer(stored === '' ? undefined : stored);
    onAdvance();
  }, [parts, withTime, range, clock12, format, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const part = (i: 0 | 1) => (
    <DateTimePart
      idPrefix={`${idPrefix}-${i}`}
      state={parts[i]}
      onChange={(next) => setPart(i, next)}
      format={format}
      withTime={withTime}
      clock12={clock12}
      invalid={Boolean(error)}
      errId={errId}
      register={(seg, el) => {
        const key = `${i}:${seg}`;
        if (el) inputs.current.set(key, el);
        else inputs.current.delete(key);
      }}
      onFilled={(seg) => {
        const at = order.indexOf(`${i}:${seg}`);
        const next = order[at + 1];
        if (next) inputs.current.get(next)?.focus();
      }}
      onEnter={submit}
    />
  );

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div
        ref={groupRef}
        className={`slate-date-ext${range ? ' slate-date-ext--range' : ''}`}
        role="group"
        aria-labelledby={labelId}
      >
        {range ? (
          <>
            <div className="slate-date-ext-end" role="group" aria-label="From">
              <span className="slate-date-ext-label" aria-hidden="true">
                From
              </span>
              {part(0)}
            </div>
            <div className="slate-date-ext-end" role="group" aria-label="To">
              <span className="slate-date-ext-label" aria-hidden="true">
                To
              </span>
              {part(1)}
            </div>
          </>
        ) : (
          part(0)
        )}
      </div>
      <FieldError id={errId} error={error} />
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-keys">press Enter ↵</span>
      </div>
    </div>
  );
}
