/**
 * Styled scales (ADR-063): stars, drawn faces, or a slider whose face (or
 * stars) react while you drag. Loaded on demand (lazyFields.tsx). The answer
 * is the same number as the plain numbers scale.
 *
 * Stars and faces are a radiogroup: arrow keys move and preview, Space/Enter
 * or a tap picks and auto-advances after the commit beat, and the form's
 * number keys still work. The slider is a native range input, so screen
 * readers and keyboards get its semantics for free; it waits for OK / Enter.
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
import '@/styles/extensions.css';

/** More cells than this and a scale is clearly misconfigured; draw the first ones only. */
const MAX_CELLS = 21;

function scaleValues(q: ScaleQuestion): number[] {
  const step = q.step && q.step > 0 ? q.step : 1;
  const out: number[] = [];
  for (let v = q.min; v <= q.max + 1e-9 && out.length < MAX_CELLS; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  return out.length ? out : [q.min];
}

/** 0 at the lowest value, 1 at the highest. */
function moodOf(v: number, q: ScaleQuestion): number {
  return q.max > q.min ? (v - q.min) / (q.max - q.min) : 0.5;
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

function ScaleIcons({ question, answers, value, onCommit }: ExtFieldProps<ScaleQuestion>) {
  const labelId = useId();
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

  // Focus lands once per question (brief §10.5): on the stored pick, else the first cell.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => focusAfter(cellsRef.current[Math.max(0, pickedIdx)] ?? null), [question.id]);

  const pick = (i: number) => {
    const v = values[i];
    if (v === undefined) return;
    markCommitted(String(v));
    onCommit(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = values.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? Math.min(last, cursor + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? Math.max(0, cursor - 1)
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
          className={`slate-scale-icons slate-scale-icons--${stars ? 'stars' : 'emoji'}${committedIdx >= 0 ? ' slate-scale-icons--committed' : ''}`}
          role="radiogroup"
          aria-labelledby={labelId}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setPreview(null)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPreview(null);
          }}
        >
          {values.map((v, i) => {
            const selected = i === pickedIdx;
            const label =
              (stars ? `${i + 1} ${i === 0 ? 'star' : 'stars'}` : String(v)) +
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
      <div className="slate-actions">
        <span className="slate-hint">
          {stars ? 'tap a star, or press a number' : 'tap a face, or press a number'}
        </span>
      </div>
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
  const values = scaleValues(question);
  const step = question.step && question.step > 0 ? question.step : 1;
  const [local, setLocal] = useState<number | undefined>(
    typeof value === 'number' ? value : undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The form's number keys store a value directly; follow it.
  useEffect(() => {
    if (typeof value === 'number') setLocal(value);
  }, [value]);

  useEffect(() => focusAfter(inputRef.current), [question.id]);

  const middle = values[Math.floor((values.length - 1) / 2)] ?? question.min;
  const shown = local ?? middle;
  const touched = local !== undefined;
  const t = moodOf(shown, question);
  const icon = question.sliderIcon ?? 'emoji';

  const submit = useCallback(() => {
    if (local === undefined) {
      if (question.required) {
        setError('Drag the slider to choose');
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
    // Number keys pick a value here too (the form's own handler skips inputs).
    if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const v = Number(e.key);
      if (values.includes(v)) {
        e.preventDefault();
        set(v);
      }
    }
  };

  const valueText =
    `${shown}` +
    (shown === question.min && question.minLabel ? `, ${question.minLabel}` : '') +
    (shown === question.max && question.maxLabel ? `, ${question.maxLabel}` : '');
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
          min={question.min}
          max={question.max}
          step={step}
          value={shown}
          aria-labelledby={labelId}
          aria-valuetext={touched ? valueText : `Not answered yet. ${valueText}`}
          aria-invalid={Boolean(error)}
          style={{ '--slate-slider-pct': `${t * 100}%` } as React.CSSProperties}
          onPointerDown={() => {
            if (!touched) set(shown);
          }}
          onChange={(e) => set(Number(e.target.value))}
          onKeyDown={onKeyDown}
        />
        <ScaleLabels q={question} />
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
        <span className="slate-hint">{touched ? 'press Enter ↵' : 'drag to answer'}</span>
      </div>
    </div>
  );
}
