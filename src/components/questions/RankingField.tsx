/**
 * Ranking — reorder a list. Up/down buttons are the keyboard-accessible
 * path; rows also drag (pointer events, so a finger works as well as a
 * mouse). A mouse drags a row at once. A finger drags only by the grip ⠿,
 * after resting on it for a moment (~250 ms, as the studio's outline does):
 * a swipe that starts on the grip, or anywhere else on the row, scrolls the
 * page and never reorders the list (QA retest). The full ordered array of
 * option values is stored on OK.
 *
 * After ↑ / ↓ the moved row flashes and keeps focus, so a respondent can
 * follow the item they're moving (QA GAP-15). A second tap at the same spot
 * lands on the row that moved in under the finger: for a moment after a
 * move, a tap on another row's ↑ / ↓ moves the same item again, as repeated
 * taps mean to. Until anything moves, OK reads "Keep this order", which is
 * what it stores. A list whose options change (the studio's live preview)
 * keeps the order of the ones still there.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RankingQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { resolveTitle } from './_resolveTitle.js';

/** A finger rests this long on the grip before the row lifts. */
const HOLD_MS = 250;
/** …and moving further than this first is a scroll, not a hold. */
const HOLD_SLOP_PX = 8;
/** For this long after a tapped move, ↑ / ↓ on another row move the same item. */
const REPEAT_MS = 700;

type Props = {
  question: RankingQuestion;
  answers: LooseAnswers;
  initialValue: string[] | undefined;
  onAnswer: (order: string[]) => void;
  onAdvance: () => void;
};

function initialOrder(question: RankingQuestion, stored: string[] | undefined): string[] {
  const values = question.options.map((o) => o.value);
  if (stored && stored.length === values.length && values.every((v) => stored.includes(v))) {
    return [...stored];
  }
  return values;
}

export function RankingField({ question, answers, initialValue, onAnswer, onAdvance }: Props) {
  const [order, setOrder] = useState<string[]>(() => initialOrder(question, initialValue));
  const [touched, setTouched] = useState(false);
  /** The row just moved by a button, flashed so the eye can follow it. */
  const [moved, setMoved] = useState<string | null>(null);
  const drag = useRef<{ id: number; value: string } | null>(null);
  /** A finger resting on a grip, not yet dragging: cancel() stops the wait. */
  const hold = useRef<{ cancel: () => void } | null>(null);
  /** The item a tap just moved, from which row and which way, and when. */
  const lastTap = useRef<{ value: string; row: number; up: boolean; at: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const labelId = useId();

  // While a finger drags a row, the page doesn't scroll under it. Registered
  // up front and not passive, so the browser honours preventDefault.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const still = (e: TouchEvent) => {
      if (drag.current && e.cancelable) e.preventDefault();
    };
    list.addEventListener('touchmove', still, { passive: false });
    return () => {
      list.removeEventListener('touchmove', still);
      hold.current?.cancel();
    };
  }, []);

  // Options edited (the studio's live preview): keep the order of those still
  // there, then the new ones, never a stale or deleted one (QA S23).
  const values = question.options.map((o) => o.value);
  const optionsKey = values.join('\u0000');
  const [seenKey, setSeenKey] = useState(optionsKey);
  if (optionsKey !== seenKey) {
    setSeenKey(optionsKey);
    setOrder((cur) => [
      ...cur.filter((v) => values.includes(v)),
      ...values.filter((v) => !cur.includes(v)),
    ]);
  }

  const labelFor = (value: string) =>
    question.options.find((o) => o.value === value)?.label ?? value;

  /** Put `value` at position `to`, from wherever it is now (drag moves can outpace renders). */
  const move = (value: string, to: number) => {
    setTouched(true);
    setOrder((cur) => {
      const from = cur.indexOf(value);
      if (from < 0 || to < 0 || to >= cur.length || from === to) return cur;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(to, 0, value);
      return next;
    });
  };

  /** ↑ / ↓: move, then keep focus on the same item where it landed. */
  const nudge = (tapped: string, row: number, up: boolean, e: React.MouseEvent) => {
    // The same button tapped again at the same spot, right after a tapped move,
    // lands on the row that slid in under the finger: that tap means the item
    // just moved (GAP-15). Keys (detail 0) always move the focused row.
    const last = lastTap.current;
    const again =
      e.detail > 0 &&
      last !== null &&
      last.row === row &&
      last.up === up &&
      Date.now() - last.at < REPEAT_MS;
    const value = again ? last.value : tapped;
    lastTap.current = e.detail > 0 ? { value, row, up, at: Date.now() } : null;
    const from = order.indexOf(value);
    const to = from + (up ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) return;
    move(value, to);
    setMoved(value);
    requestAnimationFrame(() => {
      const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
      const landed = rows.find((r) => r.dataset.rank === value);
      const btns = landed?.querySelectorAll<HTMLButtonElement>('.slate-ranking-btn');
      // At an end, the button that way is disabled: focus the other one.
      const target = btns?.[up ? (to === 0 ? 1 : 0) : to === order.length - 1 ? 0 : 1];
      target?.focus();
    });
  };

  /* ---------- drag (pointer events: mouse, finger, pen) ---------- */

  const capture = (el: Element, id: number) => {
    try {
      el.setPointerCapture(id);
    } catch {
      /* capture is a nicety */
    }
  };

  const startDrag = (e: React.PointerEvent<HTMLElement>, value: string, viaGrip: boolean) => {
    if ((e.target as HTMLElement).closest('.slate-ranking-btn')) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      e.preventDefault();
      drag.current = { id: e.pointerId, value };
      capture(e.currentTarget, e.pointerId);
      return;
    }
    // A finger or pen: only from the grip, and only after resting on it.
    if (!viaGrip) return;
    hold.current?.cancel();
    const el = e.currentTarget;
    const { pointerId, clientX, clientY } = e;
    const onMove = (m: PointerEvent) => {
      if (
        m.pointerId === pointerId &&
        Math.hypot(m.clientX - clientX, m.clientY - clientY) > HOLD_SLOP_PX
      ) {
        cancel();
      }
    };
    const onEnd = (m: PointerEvent) => {
      if (m.pointerId === pointerId) cancel();
    };
    const timer = window.setTimeout(() => {
      cancel();
      drag.current = { id: pointerId, value };
      capture(el, pointerId);
      navigator.vibrate?.(8);
    }, HOLD_MS);
    function cancel() {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      hold.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    hold.current = { cancel };
  };

  const dragMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const list = listRef.current;
    if (!d || d.id !== e.pointerId || !list) return;
    const rows = Array.from(list.children) as HTMLElement[];
    // The row whose middle is nearest the pointer is where the item goes.
    let to = 0;
    let best = Infinity;
    rows.forEach((row, i) => {
      const r = row.getBoundingClientRect();
      const dist = Math.abs(e.clientY - (r.top + r.height / 2));
      if (dist < best) {
        best = dist;
        to = i;
      }
    });
    move(d.value, to);
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const submit = useCallback(() => {
    onAnswer(order);
    onAdvance();
  }, [onAnswer, onAdvance, order]);

  useRegisterFormConfirm(submit);

  return (
    <div>
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <ol ref={listRef} className="slate-ranking" aria-labelledby={labelId}>
        {order.map((value, i) => (
          <li
            key={value}
            data-rank={value}
            className={`slate-ranking-row${moved === value ? ' slate-ranking-row--moved' : ''}`}
            onPointerDown={(e) => startDrag(e, value, false)}
            onAnimationEnd={() => setMoved(null)}
            onPointerMove={dragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span className="slate-ranking-pos">{i + 1}</span>
            <span className="slate-ranking-label">{labelFor(value)}</span>
            <span className="slate-ranking-controls">
              <button
                type="button"
                className="slate-ranking-btn"
                onClick={(e) => nudge(value, i, true, e)}
                disabled={i === 0}
                aria-label={`Move ${labelFor(value)} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="slate-ranking-btn"
                onClick={(e) => nudge(value, i, false, e)}
                disabled={i === order.length - 1}
                aria-label={`Move ${labelFor(value)} down`}
              >
                ↓
              </button>
            </span>
            <span
              className="slate-ranking-grip"
              aria-hidden="true"
              // Moves and the release bubble to the row, which handles them.
              onPointerDown={(e) => {
                e.stopPropagation();
                startDrag(e, value, true);
              }}
            >
              ⠿
            </span>
          </li>
        ))}
      </ol>

      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          {touched || initialValue ? 'OK' : 'Keep this order'} <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint">
          drag ⠿ or use ↑ ↓ to reorder<span className="slate-key-hint">, then press Enter ↵</span>
        </span>
      </div>
    </div>
  );
}
