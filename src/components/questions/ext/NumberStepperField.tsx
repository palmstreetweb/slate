/**
 * Quantity stepper for `number` questions with `display: 'stepper'`
 * (ADR-063). Big − / + buttons (56 px) either side of the value; holding one
 * repeats, faster the longer it's held. The value itself stays typeable for
 * big jumps, and it is a spinbutton: Up/Down (and + / −, where it can't go
 * below 0) step it. The answer is the number shown — optional prefix and
 * unit are display only.
 */

'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { NumberQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { NOT_A_NUMBER, parseTypedNumber } from '@/logic/numberEntry.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { motionReduced, shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import { FieldError } from './fieldMessage.js';
import '@/styles/extensions.css';

const HOLD_DELAY_MS = 420;
const HOLD_EVERY_MS = 110;
const HOLD_FAST_MS = 45;

function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(6, s.length - dot - 1);
}

export default function NumberStepperField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
  ping,
}: ExtFieldProps<NumberQuestion>) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const step = question.step && question.step > 0 ? question.step : 1;
  const decimals = decimalsOf(step);
  // Bounds set the wrong way round are ignored (as validate() does), so the
  // buttons never lock and nobody is asked for a number they can't give.
  const inverted =
    question.min !== undefined && question.max !== undefined && question.min > question.max;
  const min = inverted ? undefined : question.min;
  const max = inverted ? undefined : question.max;
  const { prefix, unit } = question;
  const parse = useCallback((t: string) => parseTypedNumber(t, prefix, unit), [prefix, unit]);

  const clamp = useCallback(
    (n: number) => {
      let v = n;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      return Number(v.toFixed(decimals));
    },
    [min, max, decimals],
  );

  // What you see is what you submit: the box starts on the stored answer,
  // else on 0 (or the nearest bound).
  const [text, setText] = useState(() => String(typeof value === 'number' ? value : clamp(0)));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef<number | null>(null);
  const holdDir = useRef<1 | -1 | 0>(0);
  /** A finger is down on − / + and hasn't stepped yet: it steps on release (a tap). */
  const tapDir = useRef<1 | -1 | 0>(0);
  /** After a + / − key, the new number is selected, so a digit typed next replaces it. */
  const selectAfterRender = useRef(false);
  useLayoutEffect(() => {
    if (!selectAfterRender.current) return;
    selectAfterRender.current = false;
    inputRef.current?.select();
  });
  const current = parse(text);
  const base = current !== undefined && Number.isFinite(current) ? current : clamp(0);
  const atMin = min !== undefined && base <= min;
  const atMax = max !== undefined && base >= max;

  useEffect(() => focusAfter(inputRef.current), [question.id]);
  useEffect(() => () => stopHold(), []);
  // A held button stops at the bound.
  useEffect(() => {
    if ((atMin && holdDir.current === -1) || (atMax && holdDir.current === 1)) stopHold();
  }, [atMin, atMax]);

  const nudge = (dir: 1 | -1) => {
    const el = inputRef.current;
    if (!el || typeof el.animate !== 'function' || motionReduced(el)) return;
    el.animate(
      [
        { transform: `translateY(${dir * -6}px)`, opacity: 0.5 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: 170, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  };

  const bump = useCallback(
    (dir: 1 | -1) => {
      setText((prev) => {
        const n = parse(prev);
        const from = n !== undefined && Number.isFinite(n) ? n : clamp(0);
        return String(clamp(from + dir * step));
      });
      setError(null);
      nudge(dir);
    },
    [clamp, step, parse],
  );

  function stopHold() {
    holdDir.current = 0;
    tapDir.current = 0;
    if (holdRef.current !== null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  }

  /**
   * A mouse or pen steps at once. A finger waits: it may be starting a scroll
   * (the browser then cancels the pointer), so it steps on release, or once
   * it has been held still long enough to start repeating.
   */
  const startHold = (dir: 1 | -1, touch: boolean) => {
    stopHold();
    if ((dir === -1 && atMin) || (dir === 1 && atMax)) return;
    holdDir.current = dir;
    if (touch) {
      tapDir.current = dir;
    } else {
      ping?.();
      bump(dir);
    }
    let repeats = 0;
    const tick = () => {
      if (tapDir.current) {
        tapDir.current = 0;
        ping?.();
      }
      bump(dir);
      repeats += 1;
      holdRef.current = window.setTimeout(tick, repeats > 8 ? HOLD_FAST_MS : HOLD_EVERY_MS);
    };
    holdRef.current = window.setTimeout(tick, HOLD_DELAY_MS);
  };

  const submit = useCallback(() => {
    const n = parse(text);
    if (n !== undefined && Number.isNaN(n)) {
      setError(NOT_A_NUMBER);
      shakeInvalid(inputRef.current);
      return;
    }
    const err = validate(question, n);
    if (err) {
      setError(err.message);
      shakeInvalid(inputRef.current);
      return;
    }
    setError(null);
    onAnswer(n);
    onAdvance();
  }, [text, question, parse, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // + and − step only where a number can't be negative; elsewhere they are
    // signs, so "-5" types minus five (not five after a step down to -1).
    const signs = min !== undefined && min >= 0;
    if (e.key === 'ArrowUp' || (e.key === '+' && signs)) {
      e.preventDefault();
      bump(1);
      if (e.key === '+') selectAfterRender.current = true;
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === '-' && signs)) {
      e.preventDefault();
      if (e.key === '-') {
        // "-2" where only 0 or more is allowed (F19): at the bottom, say so
        // instead of stepping; either way the number shown is selected, so
        // the next digit replaces it ("2", never "02" read as 2).
        if (atMin) setError(validate(question, base - step)?.message ?? null);
        else bump(-1);
        e.currentTarget.select();
        selectAfterRender.current = true;
        return;
      }
      bump(-1);
      return;
    }
    if (isTypewriterKey(e)) onType?.();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const holdProps = (dir: 1 | -1) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startHold(dir, e.pointerType === 'touch');
    },
    // A finger lifted without scrolling or holding was a tap: step once now.
    onPointerUp: () => {
      if (tapDir.current === dir) {
        ping?.();
        bump(dir);
      }
      stopHold();
    },
    onPointerLeave: stopHold,
    // The browser took the gesture for a scroll: nothing changes.
    onPointerCancel: stopHold,
    // Keyboard (Enter/Space) and assistive tech click without a pointer.
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail === 0 && !((dir === -1 && atMin) || (dir === 1 && atMax))) {
        ping?.();
        bump(dir);
      }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div className="slate-stepper" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          className="slate-stepper-btn"
          aria-label={`Decrease by ${step}`}
          aria-disabled={atMin || undefined}
          {...holdProps(-1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12h14" />
          </svg>
        </button>
        <div className={`slate-stepper-field${error ? ' slate-stepper-field--error' : ''}`}>
          {question.prefix ? (
            <span className="slate-num-affix" aria-hidden="true">
              {question.prefix}
            </span>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            inputMode={decimals > 0 || (min !== undefined && min < 0) ? 'decimal' : 'numeric'}
            role="spinbutton"
            className="slate-stepper-input"
            value={text}
            size={Math.max(2, Math.min(10, text.length + 1))}
            aria-labelledby={labelId}
            aria-valuenow={current !== undefined && Number.isFinite(current) ? current : undefined}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={
              current !== undefined && Number.isFinite(current)
                ? `${question.prefix ?? ''}${current}${question.unit ? ` ${question.unit}` : ''}`
                : undefined
            }
            aria-invalid={Boolean(error)}
            aria-describedby={errId}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />
          {question.unit ? (
            <span className="slate-num-affix slate-num-affix--unit" aria-hidden="true">
              {question.unit}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="slate-stepper-btn"
          aria-label={`Increase by ${step}`}
          aria-disabled={atMax || undefined}
          {...holdProps(1)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
      </div>
      <FieldError id={errId} error={error} />
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint">hold − / + to go faster</span>
      </div>
    </div>
  );
}
