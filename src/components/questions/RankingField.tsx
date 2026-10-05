/**
 * Ranking — reorder a list. Up/down buttons are the keyboard-accessible
 * path; rows also drag (pointer events, so a finger works as well as a
 * mouse: on a touch screen the grip ⠿ drags, so the rest of the row still
 * scrolls the page). The full ordered array of option values is stored on
 * OK.
 *
 * After ↑ / ↓ the moved row flashes and keeps focus, so a respondent can
 * follow the item they're moving (QA GAP-15). Until anything moves, OK reads
 * "Keep this order", which is what it stores. A list whose options change
 * (the studio's live preview) keeps the order of the ones still there.
 */

'use client';

import { useCallback, useId, useRef, useState } from 'react';
import type { RankingQuestion } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { resolveTitle } from './_resolveTitle.js';

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
  const listRef = useRef<HTMLOListElement>(null);
  const labelId = useId();

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
  const nudge = (value: string, from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    move(value, to);
    setMoved(value);
    requestAnimationFrame(() => {
      const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
      const row = rows.find((r) => r.dataset.rank === value);
      const btns = row?.querySelectorAll<HTMLButtonElement>('.slate-ranking-btn');
      const up = to < from;
      // At an end, the button that way is disabled: focus the other one.
      const target = btns?.[up ? (to === 0 ? 1 : 0) : to === order.length - 1 ? 0 : 1];
      target?.focus();
    });
  };

  /* ---------- drag (pointer events: mouse, finger, pen) ---------- */

  const startDrag = (e: React.PointerEvent<HTMLElement>, value: string, viaGrip: boolean) => {
    if (e.pointerType === 'mouse' ? e.button !== 0 : !viaGrip) return;
    if ((e.target as HTMLElement).closest('.slate-ranking-btn')) return;
    e.preventDefault();
    drag.current = { id: e.pointerId, value };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
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
                onClick={() => nudge(value, i, i - 1)}
                disabled={i === 0}
                aria-label={`Move ${labelFor(value)} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="slate-ranking-btn"
                onClick={() => nudge(value, i, i + 1)}
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
