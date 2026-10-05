/**
 * Pin the spot (ADR-065), loaded on demand. The owner's photo (a house, a
 * roof, a car); the respondent taps it to drop numbered pins — up to the
 * owner's limit — and can leave a short note on each ("leak here").
 *
 * Pins are stored as fractions of the photo (0–1), so they land on the same
 * spot at every size and in Responses. A pin can be dragged to adjust it.
 * Without a pointer: focus the photo, move the crosshair with the arrow keys
 * (Shift for bigger steps) and press Space to drop a pin; a focused pin moves
 * with the arrows and Delete removes it. Enter is OK, as everywhere.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { ImagePinQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { PIN_NOTE_MAX, pinLimit, pinText, pinsOf } from '@/logic/pins.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { PIN_IMAGE_DATA_MAX, safeImageSrc } from '@/utils/brandLogo.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';
import '@/styles/extensions-c.css';

type Pin = { x: number; y: number; note: string; key: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function ImagePinField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
  ping,
}: ExtFieldProps<ImagePinQuestion>) {
  const titleId = useId();
  const howId = useId();
  const limit = pinLimit(question as unknown as Record<string, unknown>);
  const withNotes = question.notes !== false;
  const src = safeImageSrc(question.image, PIN_IMAGE_DATA_MAX);
  const nextKey = useRef(1);
  const [pins, setPins] = useState<Pin[]>(() =>
    pinsOf(value).map((p) => ({ ...p, key: nextKey.current++ })),
  );
  const [fresh, setFresh] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [ratio, setRatio] = useState(4 / 3);
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);
  const moving = useRef<{ key: number; id: number; moved: boolean } | null>(null);
  const down = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => focusAfter(areaRef.current), [question.id]);

  /** Store the pins (and notes when asked) as the answer. */
  const save = useCallback(
    (next: Pin[]) => {
      setPins(next);
      if (next.length === 0) {
        onAnswer(undefined);
        return;
      }
      const out: Record<string, string[]> = { pins: next.map((p) => pinText(p.x, p.y)) };
      if (withNotes && next.some((p) => p.note.trim())) out.notes = next.map((p) => p.note.trim());
      onAnswer(out);
    },
    [onAnswer, withNotes],
  );

  const toBox = (e: { clientX: number; clientY: number }) => {
    const r = areaRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - r.left) / Math.max(1, r.width)),
      y: clamp01((e.clientY - r.top) / Math.max(1, r.height)),
    };
  };

  const drop = (x: number, y: number) => {
    if (pins.length >= limit) {
      setError(`That’s ${limit} ${limit === 1 ? 'pin' : 'pins'} — remove one to add another`);
      shakeInvalid(areaRef.current);
      return;
    }
    const pin = { x, y, note: '', key: nextKey.current++ };
    ping?.();
    setError(null);
    setFresh(pin.key);
    save([...pins, pin]);
    setSaid(
      `Pin ${pins.length + 1} dropped at ${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down.`,
    );
  };

  const remove = (key: number) => {
    const i = pins.findIndex((p) => p.key === key);
    if (i < 0) return;
    save(pins.filter((p) => p.key !== key));
    setError(null);
    setSaid(`Pin ${i + 1} removed.`);
  };

  const move = (key: number, x: number, y: number) =>
    save(pins.map((p) => (p.key === key ? { ...p, x: clamp01(x), y: clamp01(y) } : p)));

  /* Taps on the photo drop a pin; a drag scrolls the page (touch) and drops nothing. */
  const onAreaDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.pinSurface) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onAreaUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    down.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    const { x, y } = toBox(e);
    setCursor(null);
    drop(x, y);
  };

  /* Dragging a pin moves it. */
  const onPinDown = (key: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    moving.current = { key, id: e.pointerId, moved: false };
  };
  const onPinMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const m = moving.current;
    if (!m || m.id !== e.pointerId) return;
    m.moved = true;
    const { x, y } = toBox(e);
    setPins((cur) => cur.map((p) => (p.key === m.key ? { ...p, x, y } : p)));
  };
  const onPinUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const m = moving.current;
    moving.current = null;
    if (!m || m.id !== e.pointerId || !m.moved) return;
    const { x, y } = toBox(e);
    move(m.key, x, y);
  };

  /* Keyboard: a crosshair on the photo; Enter / Space drops a pin there. */
  const onAreaKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    const c = cursor ?? { x: 0.5, y: 0.5 };
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = moves[e.key];
    if (d) {
      e.preventDefault();
      setCursor({ x: clamp01(c.x + d[0]), y: clamp01(c.y + d[1]) });
      return;
    }
    // Space drops a pin; Enter stays OK (the form's own key, ADR-059).
    if (e.key === ' ') {
      e.preventDefault();
      drop(c.x, c.y);
    }
  };

  const onPinKey = (pin: Pin) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = moves[e.key];
    if (d) {
      e.preventDefault();
      move(pin.key, pin.x + d[0], pin.y + d[1]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(pin.key);
      areaRef.current?.focus();
    }
  };

  const submit = useCallback(() => {
    const answer =
      pins.length === 0
        ? undefined
        : {
            pins: pins.map((p) => pinText(p.x, p.y)),
            ...(withNotes && pins.some((p) => p.note.trim())
              ? { notes: pins.map((p) => p.note.trim()) }
              : {}),
          };
    const err = validate(question, answer);
    if (err) {
      setError(err.message);
      shakeInvalid(areaRef.current);
      return;
    }
    setError(null);
    onAnswer(answer);
    onAdvance();
  }, [pins, withNotes, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const alt = question.imageAlt?.trim() || 'The photo to mark';
  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <p className="slate-subtitle slate-pin-lede">
        {limit === 1 ? 'Mark one spot' : `Mark up to ${limit} spots`}
        {withNotes ? ', with a short note on each.' : '.'}
      </p>

      <div className="slate-pin">
        <div
          ref={areaRef}
          className={`slate-pin-area${src && !broken ? '' : ' slate-pin-area--blank'}${error ? ' slate-pin-area--error' : ''}`}
          style={{ '--slate-pin-ratio': ratio } as CSSProperties}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={howId}
          tabIndex={0}
          onPointerDown={onAreaDown}
          onPointerUp={onAreaUp}
          onPointerCancel={() => (down.current = null)}
          onKeyDown={onAreaKey}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setCursor(null);
          }}
        >
          {src && !broken ? (
            <img
              className="slate-pin-img"
              src={src}
              alt={alt}
              draggable={false}
              decoding="async"
              referrerPolicy="no-referrer"
              data-pin-surface="1"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setRatio(img.naturalWidth / img.naturalHeight);
                }
              }}
              onError={() => setBroken(true)}
            />
          ) : (
            <span className="slate-pin-blank" data-pin-surface="1" aria-hidden="true">
              {broken
                ? 'The photo didn’t load — tap to mark the spot anyway'
                : 'Tap to mark the spot'}
            </span>
          )}
          {cursor ? (
            <span
              className="slate-pin-cursor"
              style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
              aria-hidden="true"
            />
          ) : null}
          {pins.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className={`slate-pin-dot${fresh === p.key ? ' slate-pin-dot--fresh' : ''}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              aria-label={`Pin ${i + 1}, ${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down${
                p.note.trim() ? `: ${p.note.trim()}` : ''
              }. Arrow keys move it, Delete removes it.`}
              onPointerDown={onPinDown(p.key)}
              onPointerMove={onPinMove}
              onPointerUp={onPinUp}
              onPointerCancel={() => (moving.current = null)}
              onKeyDown={onPinKey(p)}
              onAnimationEnd={() => setFresh((f) => (f === p.key ? null : f))}
            >
              <span className="slate-pin-num">{i + 1}</span>
            </button>
          ))}
        </div>
        <p id={howId} className="slate-sr">
          Tap the photo to drop a pin. With a keyboard, move the crosshair with the arrow keys and
          press Space to drop a pin.
        </p>

        <div className="slate-pin-meta">
          <span className="slate-pin-count">
            {pins.length} of {limit} {limit === 1 ? 'pin' : 'pins'}
          </span>
          {pins.length > 0 ? (
            <button
              type="button"
              className="slate-pin-clear"
              onClick={() => {
                save([]);
                setSaid('All pins removed.');
              }}
            >
              Clear all
            </button>
          ) : null}
        </div>

        {pins.length > 0 ? (
          <ol className="slate-pin-list">
            {pins.map((p, i) => (
              <li
                key={p.key}
                className={`slate-pin-row${fresh === p.key ? ' slate-pin-row--fresh' : ''}`}
              >
                <span className="slate-pin-badge" aria-hidden="true">
                  {i + 1}
                </span>
                {withNotes ? (
                  <input
                    className="slate-input slate-pin-note"
                    value={p.note}
                    maxLength={PIN_NOTE_MAX}
                    placeholder="What’s here? (optional)"
                    aria-label={`Note for pin ${i + 1}`}
                    enterKeyHint="done"
                    onChange={(e) =>
                      save(pins.map((q) => (q.key === p.key ? { ...q, note: e.target.value } : q)))
                    }
                    onKeyDown={(e) => {
                      if (isTypewriterKey(e)) onType?.();
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                  />
                ) : (
                  <span className="slate-pin-row-text">Pin {i + 1}</span>
                )}
                <button
                  type="button"
                  className="slate-pin-remove"
                  aria-label={`Remove pin ${i + 1}`}
                  onClick={() => remove(p.key)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
      {error ? (
        <p className="slate-err" aria-live="polite">
          {error}
        </p>
      ) : null}
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-keys">press Enter ↵</span>
      </div>
    </div>
  );
}
