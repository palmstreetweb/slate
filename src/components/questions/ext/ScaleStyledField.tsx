/**
 * Styled scales (ADR-063): stars, drawn faces, or a slider whose face (or
 * stars) react while you drag. Loaded on demand (lazyFields.tsx). The answer
 * is the same number as the plain numbers scale.
 *
 * Stars and faces are a radiogroup: arrow keys move and preview, a tap (or
 * Space / Enter on the star the keyboard moved to) picks and auto-advances
 * after the commit beat, and the form's number keys still work. Focus starts
 * on the group, not the first star, so an Enter pressed out of habit picks
 * nothing: an optional rating moves on (Skip), a required one says what to do.
 * Each star is named by its value ("4.5 stars"), which is what is stored.
 *
 * The slider is a native range input, so screen readers and keyboards get its
 * semantics for free; it waits for OK / Enter. A scroll that starts on it
 * leaves it as it was.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ScaleQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import { Face, Star } from './scaleArt.js';
import { nearestStep, scaleRange, scaleValues } from './scaleCells.js';
import { FieldError } from './fieldMessage.js';
import { TapActions } from './TapActions.js';
import '@/styles/extensions.css';

/** 0 at the lowest value, 1 at the highest. */
function moodOf(v: number, q: ScaleQuestion): number {
  const { lo, hi } = scaleRange(q);
  return hi > lo ? (v - lo) / (hi - lo) : 0.5;
}

function ScaleLabels({ q }: { q: ScaleQuestion }) {
  if (!q.minLabel && !q.maxLabel) return null;
  return (
    <div className="slate-scale-labels">
      <span>{q.minLabel ?? ''}</span>
      <span>{q.maxLabel ?? ''}</span>
    </div>
  );
}

export default function ScaleStyledField(props: ExtFieldProps<ScaleQuestion>) {
  return props.question.display === 'slider' ? (
    <ScaleSlider {...props} />
  ) : (
    <ScaleIcons {...props} />
  );
}

/* ---------- stars and faces ---------- */

function ScaleIcons({ question, answers, value, onCommit, onAdvance }: ExtFieldProps<ScaleQuestion>) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const stars = question.display === 'stars';
  const values = scaleValues(question);
  const picked = typeof value === 'number' ? value : undefined;
  const pickedIdx = picked === undefined ? -1 : values.indexOf(picked);
  const [preview, setPreview] = useState<number | null>(null);
  const [cursor, setCursor] = useState(Math.max(0, pickedIdx));
  const { committed, markCommitted } = useChoiceCommit(
    picked === undefined ? undefined : String(picked),
  );
  const cellsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const groupRef = useRef<HTMLDivElement>(null);

  // Focus lands once per question (brief §10.5): on the stored pick, else on
  // the group, so Enter or Space right away picks nothing.
  useEffect(
    () => focusAfter(pickedIdx >= 0 ? (cellsRef.current[pickedIdx] ?? null) : groupRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question.id],
  );

  const pick = (i: number) => {
    const v = values[i];
    if (v === undefined) return;
    markCommitted(String(v));
    onCommit(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = values.length - 1;
    // From the group itself (nothing focused yet), the first arrow lands on the first icon.
    const from = e.target === e.currentTarget ? -1 : cursor;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? Math.min(last, from + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? Math.max(0, from - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    setCursor(next);
    setPreview(next);
    cellsRef.current[next]?.focus();
  };

  // What's lit: the hovered / focused cell while previewing, else the pick.
  const lit = preview ?? pickedIdx;
  const committedIdx = committed !== null ? values.indexOf(Number(committed)) : -1;

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div className="slate-scale slate-scale--icons">
        <div
          ref={groupRef}
          tabIndex={-1}
          className={`slate-scale-icons slate-scale-icons--${stars ? 'stars' : 'emoji'}${committedIdx >= 0 ? ' slate-scale-icons--committed' : ''}`}
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={errId}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setPreview(null)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPreview(null);
          }}
        >
          {values.map((v, i) => {
            const selected = i === pickedIdx;
            // Named by the value stored: a 0–5 scale's first star is "0 stars".
            const label =
              (stars ? `${v} ${v === 1 ? 'star' : 'stars'}` : String(v)) +
              (i === 0 && question.minLabel ? `, ${question.minLabel}` : '') +
              (i === values.length - 1 && question.maxLabel ? `, ${question.maxLabel}` : '');
            const fill = stars
              ? i <= lit
                ? preview !== null && preview !== pickedIdx
                  ? 'preview'
                  : 'on'
                : 'off'
              : null;
            return (
              <button
                key={v}
                ref={(el) => {
                  cellsRef.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                tabIndex={i === cursor ? 0 : -1}
                style={{ '--slate-i': i } as React.CSSProperties}
                className={`slate-scale-icon${selected ? ' slate-scale-icon--selected' : ''}${i === lit ? ' slate-scale-icon--lit' : ''}${i === committedIdx ? ' slate-scale-icon--committed' : ''}`}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') setPreview(i);
                }}
                onFocus={() => setCursor(i)}
                onClick={() => pick(i)}
              >
                {fill ? <Star fill={fill} /> : <Face t={moodOf(v, question)} />}
                {stars ? null : (
                  <span className="slate-scale-icon-n" aria-hidden="true">
                    {v}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <ScaleLabels q={question} />
      </div>
      <TapActions
        answered={picked !== undefined}
        required={question.required === true}
        check={() =>
          picked === undefined
            ? question.required
              ? 'Please pick a rating'
              : null
            : (validate(question, picked)?.message ?? null)
        }
        onAdvance={onAdvance}
        target={groupRef}
        errorId={errId}
        // Enter on the icon the keyboard moved to picks it.
        pickFocused={() => {
          const i = cellsRef.current.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return false;
          pick(i);
          return true;
        }}
        hint={
          <span className="slate-hint">
            {stars ? 'tap a star' : 'tap a face'}
            <span className="slate-keys">, or press a number</span>
          </span>
        }
      />
    </div>
  );
}

/* ---------- slider ---------- */

function ScaleSlider({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
}: ExtFieldProps<ScaleQuestion>) {
  const labelId = useId();
  const errId = `${labelId}-err`;
  const values = scaleValues(question);
  const { lo, hi, step } = scaleRange(question);
  const [local, setLocal] = useState<number | undefined>(
    typeof value === 'number' ? value : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The answer before a touch began: a touch that turns into a scroll puts it back. */
  const beforeTouch = useRef<number | undefined>(undefined);

  // The form's number keys store a value directly; follow it.
  useEffect(() => {
    if (typeof value === 'number') setLocal(value);
  }, [value]);

  useEffect(() => focusAfter(inputRef.current), [question.id]);

  // The real middle of the range, on the step grid (not of the first 21 cells).
  const middle = nearestStep(question, (lo + hi) / 2);
  const shown = local ?? middle;
  const touched = local !== undefined;
  const t = moodOf(shown, question);
  const icon = question.sliderIcon ?? 'emoji';

  const submit = useCallback(() => {
    if (local === undefined) {
      if (question.required) {
        setError('Move the slider to choose a number');
        shakeInvalid(inputRef.current);
        return;
      }
      onAdvance();
      return;
    }
    const err = validate(question, local);
    if (err) {
      setError(err.message);
      shakeInvalid(inputRef.current);
      return;
    }
    setError(null);
    onAnswer(local);
    onAdvance();
  }, [local, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const set = (v: number) => {
    setLocal(v);
    if (error) setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    // Number keys pick a value here too (the form's own handler skips inputs),
    // snapped to the nearest step: 7 on a 0–100 by 5 slider is 5.
    if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      set(nearestStep(question, Number(e.key)));
    }
  };

  const valueText =
    `${shown}` +
    (shown === lo && question.minLabel ? `, ${question.minLabel}` : '') +
    (shown === hi && question.maxLabel ? `, ${question.maxLabel}` : '');
  const starCount = Math.min(values.length, 10);
  const litStars = Math.round(t * (starCount - 1)) + 1;

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div className="slate-scale slate-slider" data-untouched={touched ? undefined : ''}>
        <div className="slate-slider-readout" aria-hidden="true">
          {icon === 'emoji' ? <Face t={t} className="slate-slider-face" /> : null}
          {icon === 'stars' ? (
            <span className="slate-slider-stars">
              {Array.from({ length: starCount }, (_, i) => (
                <Star key={i} fill={i < litStars ? 'on' : 'off'} />
              ))}
            </span>
          ) : null}
          <span className="slate-slider-value">{touched ? shown : '–'}</span>
        </div>
        <input
          ref={inputRef}
          type="range"
          className="slate-slider-input"
          min={lo}
          max={hi}
          step={step}
          value={shown}
          aria-labelledby={labelId}
          aria-describedby={errId}
          aria-valuetext={touched ? valueText : `Not answered yet. ${valueText}`}
          aria-invalid={Boolean(error)}
          style={{ '--slate-slider-pct': `${t * 100}%` } as React.CSSProperties}
          // A tap on the thumb where it sits answers with that value.
          onPointerDown={() => {
            beforeTouch.current = local;
            if (!touched) set(shown);
          }}
          // The browser took the gesture for a page scroll: nothing was chosen.
          onPointerCancel={() => setLocal(beforeTouch.current)}
          onChange={(e) => set(Number(e.target.value))}
          onKeyDown={onKeyDown}
        />
        <ScaleLabels q={question} />
      </div>
      <FieldError id={errId} error={error} />
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        {touched ? (
          <span className="slate-hint slate-keys">press Enter ↵</span>
        ) : (
          <span className="slate-hint">drag to answer</span>
        )}
      </div>
    </div>
  );
}
