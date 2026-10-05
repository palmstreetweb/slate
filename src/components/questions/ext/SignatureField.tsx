/**
 * Signature (ADR-064): draw with a finger, pen or mouse on a canvas, with
 * Clear, or — for keyboard and screen-reader users — type your name instead.
 * Loaded on demand.
 *
 * The drawing is kept as vector strokes in a fixed 500 × 200 box (the canvas
 * keeps that aspect at every width), so it survives resizes, rotation and a
 * theme switch, and is stored inside the answer as a compact SVG path
 * (`logic/signature.ts`) — no image, no upload. "Required" means real ink: a
 * dot or a stray tap doesn't count.
 */

'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SignatureQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { encodeSignature } from '@/logic/signatureEncode.js';
import {
  SIG_H,
  SIG_TYPED_MAX,
  SIG_W,
  isRealSignature,
  parseSignaturePath,
  signaturePathOf,
  signatureTypedOf,
  type Point,
} from '@/logic/signature.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { motionReduced, shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import { FieldError } from './fieldMessage.js';
import '@/styles/extensions.css';

/** Ink width in box units (≈2 px on a phone, ≈3.5 px on a desktop). */
const INK = 3.2;

function drawStroke(ctx: CanvasRenderingContext2D, s: ReadonlyArray<Point>) {
  if (s.length === 0) return;
  const [x0, y0] = s[0]!;
  if (s.length === 1) {
    ctx.beginPath();
    ctx.arc(x0, y0, INK / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  // Quadratic curves through the midpoints: smooth ink without extra points.
  for (let k = 1; k < s.length - 1; k++) {
    const [x, y] = s[k]!;
    const [nx, ny] = s[k + 1]!;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const [lx, ly] = s[s.length - 1]!;
  ctx.lineTo(lx, ly);
  ctx.stroke();
}

/**
 * The vertical distance (box units) of a stroke that was really a scroll: a
 * quick (under half a second), mostly up-or-down swipe that runs off the top
 * or the bottom of the pad. 0 for anything that could be ink.
 */
function scrollFlick(stroke: ReadonlyArray<Point>, ms: number): number {
  const first = stroke[0];
  const last = stroke[stroke.length - 1];
  if (!first || !last || ms > 500) return 0;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const offPad = stroke.some(([, y]) => y < 0 || y > SIG_H);
  return offPad && Math.abs(dy) > SIG_H * 0.4 && Math.abs(dx) < Math.abs(dy) / 2 ? dy : 0;
}

/** Scroll whatever scrolls around the pad (a preview frame, else the page). */
function scrollPageBy(from: Element | null, top: number) {
  let el = from?.parentElement ?? null;
  while (el) {
    const { overflowY } = getComputedStyle(el);
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(overflowY)) break;
    el = el.parentElement;
  }
  (el ?? document.scrollingElement)?.scrollBy?.({ top, behavior: 'smooth' });
}

export default function SignatureField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
}: ExtFieldProps<SignatureQuestion>) {
  const titleId = useId();
  const hintId = useId();
  const allowTyped = question.allowTyped !== false;
  const seededTyped = signatureTypedOf(value);
  const [mode, setMode] = useState<'draw' | 'type'>(
    seededTyped !== null && allowTyped ? 'type' : 'draw',
  );
  const [typed, setTyped] = useState(seededTyped ?? '');
  const [error, setError] = useState<string | null>(null);
  const strokes = useRef<Point[][]>(parseSignaturePath(signaturePathOf(value)) ?? []);
  const [hasInk, setHasInk] = useState(strokes.current.length > 0);
  const drawing = useRef<Point[] | null>(null);
  const strokeStart = useRef({ at: 0, touch: false });
  const padRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => focusAfter(mode === 'type' ? typedRef.current : padRef.current),
    // Focus once per question (and when switching modes), not on every stroke.
    [question.id, mode],
  );

  /** Repaint every stroke at the canvas's current size, in the theme's ink colour. */
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.clientWidth;
    if (width === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(width * dpr);
    const h = Math.round(width * (SIG_H / SIG_W) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const scale = w / SIG_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const ink = getComputedStyle(canvas).color || 'currentColor';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) drawStroke(ctx, s);
    if (drawing.current) drawStroke(ctx, drawing.current);
  }, []);

  // Size changes (rotation, rails) and theme switches repaint from the vectors.
  useLayoutEffect(() => {
    if (mode !== 'draw') return undefined;
    repaint();
    const canvas = canvasRef.current;
    const ro =
      typeof ResizeObserver === 'function' && canvas ? new ResizeObserver(() => repaint()) : null;
    if (ro && canvas) ro.observe(canvas);
    const wrapper = canvas?.closest('[data-slate-forms]');
    const mo =
      typeof MutationObserver === 'function' && wrapper
        ? new MutationObserver(() => repaint())
        : null;
    if (mo && wrapper) mo.observe(wrapper, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [mode, repaint]);

  const toBox = (e: { clientX: number; clientY: number }): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / Math.max(1, rect.width)) * SIG_W,
      ((e.clientY - rect.top) / Math.max(1, rect.height)) * SIG_H,
    ];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    drawing.current = [toBox(e)];
    strokeStart.current = { at: e.timeStamp, touch: e.pointerType === 'touch' };
    if (error) setError(null);
    repaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current;
    if (!stroke) return;
    const native = e.nativeEvent;
    const events =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [native]) stroke.push(toBox(ev));
    repaint();
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current;
    drawing.current = null;
    if (!stroke) return;
    // The pad keeps the finger so it can draw (touch-action: none), so a quick
    // up-or-down flick that runs off the pad was meant to scroll the page
    // (SCROLL-12): it leaves no mark, and the page scrolls by that much.
    const dy = scrollFlick(stroke, e.timeStamp - strokeStart.current.at);
    if (strokeStart.current.touch && dy !== 0) {
      repaint();
      const rect = canvasRef.current?.getBoundingClientRect();
      scrollPageBy(padRef.current, (-dy * (rect?.height ?? SIG_H)) / SIG_H);
      return;
    }
    strokes.current = [...strokes.current, stroke];
    setHasInk(true);
    repaint();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const wipe = () => {
      strokes.current = [];
      drawing.current = null;
      setHasInk(false);
      setError(null);
      onAnswer(undefined);
      repaint();
    };
    if (canvas && typeof canvas.animate === 'function' && !motionReduced(canvas)) {
      // Ink fades out, then the empty pad is back at full opacity.
      const fade = canvas.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 160,
        easing: 'ease-in',
        fill: 'forwards',
      });
      const done = () => {
        wipe();
        fade.cancel();
      };
      fade.finished.then(done, done);
    } else {
      wipe();
    }
  };

  const submit = useCallback(() => {
    let answer: { path: string } | { typed: string } | undefined;
    if (mode === 'type') {
      const name = typed.trim();
      answer = name ? { typed: name.slice(0, SIG_TYPED_MAX) } : undefined;
    } else if (strokes.current.length) {
      const path = encodeSignature(strokes.current);
      answer = path ? { path } : undefined;
    }
    // A drawing that encodes to nothing but a dot fails "real ink" even when
    // optional; an optional signature can still be cleared and skipped.
    const err =
      answer && 'path' in answer && !isRealSignature(parseSignaturePath(answer.path))
        ? {
            message: question.required
              ? 'That’s only a dot. Please sign your full name.'
              : 'That’s only a dot. Sign your full name, or tap Clear to skip.',
          }
        : mode === 'type' && !answer && question.required
          ? { message: 'Please type your full name' }
          : validate(question, answer);
    if (err) {
      setError(err.message);
      shakeInvalid(mode === 'type' ? typedRef.current : padRef.current);
      return;
    }
    setError(null);
    onAnswer(answer);
    onAdvance();
  }, [mode, typed, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      {question.body ? <p className="slate-subtitle slate-sig-body">{question.body}</p> : null}

      {mode === 'draw' ? (
        <div
          ref={padRef}
          className={`slate-sig${hasInk ? ' slate-sig--inked' : ''}${error ? ' slate-sig--error' : ''}`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={error ? `${hintId} ${titleId}-err` : hintId}
          tabIndex={-1}
        >
          <div className="slate-sig-pad">
            <canvas
              ref={canvasRef}
              className="slate-sig-canvas"
              role="img"
              aria-label={hasInk ? 'Your signature' : 'Signature pad, empty'}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onLostPointerCapture={endStroke}
              onContextMenu={(e) => e.preventDefault()}
            />
            <span className="slate-sig-line" aria-hidden="true">
              <span className="slate-sig-x">×</span>
            </span>
            <span className="slate-sig-hint" aria-hidden="true">
              Sign here
            </span>
          </div>
          <p id={hintId} className="slate-sr">
            Draw your signature with a finger or mouse.
            {allowTyped ? ' Or use Type your name instead.' : ''}
          </p>
          <div className="slate-sig-tools">
            <button type="button" className="slate-sig-tool" onClick={clear} disabled={!hasInk}>
              Clear
            </button>
            {allowTyped ? (
              <button
                type="button"
                className="slate-sig-tool slate-sig-tool--switch"
                onClick={() => {
                  setError(null);
                  setMode('type');
                }}
              >
                Type your name instead
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="slate-sig slate-sig--typed">
          <label className="slate-part">
            <span className="slate-part-label">Type your full name</span>
            <input
              ref={typedRef}
              className={`slate-input slate-sig-typed${error ? ' slate-input--error' : ''}`}
              type="text"
              name="name"
              autoComplete="name"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              maxLength={SIG_TYPED_MAX}
              placeholder="Jane Smith"
              value={typed}
              aria-invalid={Boolean(error)}
              aria-describedby={`${titleId}-err`}
              onChange={(e) => {
                setTyped(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (isTypewriterKey(e)) onType?.();
                if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          <div className="slate-sig-tools">
            <button
              type="button"
              className="slate-sig-tool slate-sig-tool--switch"
              onClick={() => {
                setError(null);
                setMode('draw');
              }}
            >
              Draw instead
            </button>
          </div>
        </div>
      )}

      <FieldError id={`${titleId}-err`} error={error} />
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-keys">press Enter ↵</span>
      </div>
    </div>
  );
}
