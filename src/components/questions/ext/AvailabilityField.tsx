/**
 * Availability week grid (ADR-065), loaded on demand. The respondent paints
 * the times they're free across the owner's days (When2meet style):
 *
 *   - mouse / pen: press and drag to paint (or erase, when the first cell was
 *     already painted);
 *   - touch: tap a cell, or hold ~½ s then drag to paint; a swipe still
 *     scrolls the page, and a sideways drag paints straight away;
 *   - keyboard: arrow keys move, Space toggles, Shift + arrows paint as they go;
 *   - a day's header or a time label fills (or clears) that whole column or row.
 *
 * The answer is re-encoded after every change as merged ranges per day
 * (`logic/availability.ts`), so what is stored is always canonical.
 */

'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { AvailabilityQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import {
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  availabilityGrid,
  clockLabel,
  decodeAvailability,
  encodeAvailability,
} from '@/logic/availability.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import { FieldError } from './fieldMessage.js';
import '@/styles/extensions.css';
import '@/styles/extensions-c.css';

/**
 * Hold this long on touch before a drag paints instead of scrolling (GAP-18):
 * long enough that a finger resting a moment before a swipe still scrolls,
 * with the held cell filling in meanwhile (`is-pressing`) so a deliberate
 * hold can be seen coming.
 */
const HOLD_MS = 550;

const cellKey = (day: string, slot: number) => `${day}:${slot}`;

/** "15 min", "1 hour", "1 hr 15 min", "3 hours" (GAP-26). */
function freeTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  if (!m) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return `${h} hr ${m} min`;
}

export default function AvailabilityField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  ping,
}: ExtFieldProps<AvailabilityQuestion>) {
  const titleId = useId();
  const howId = useId();
  const grid = useMemo(
    () => availabilityGrid(question as unknown as Record<string, unknown>),
    [question],
  );
  const [picked, setPicked] = useState<Set<string>>(() => {
    const out = new Set<string>();
    decodeAvailability(grid, value).forEach((slots, day) =>
      slots.forEach((i) => out.add(cellKey(day, i))),
    );
    return out;
  });
  const [focus, setFocus] = useState<{ d: number; s: number }>({ d: 0, s: 0 });
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const paint = useRef<{
    id: number;
    mode: 'add' | 'remove';
    touch: boolean;
    active: boolean;
    x0: number;
    y0: number;
    timer: number;
    start: string | null;
    /** The last painted cell: a fast drag skips cells, so the line between is filled. */
    last: string | null;
    /** The cell a finger is holding, filling in until the hold paints it. */
    pressing?: HTMLElement | null;
  } | null>(null);

  /** The finger lifted, scrolled or drew sideways: the held cell stops filling in. */
  const unpress = (p: NonNullable<typeof paint.current>) => {
    p.pressing?.classList.remove('is-pressing');
    p.pressing = null;
  };

  useEffect(
    () => focusAfter(gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? null),
    [question.id],
  );

  const commit = useCallback(
    (next: Set<string>) => {
      // Now, not at the next render: a fast drag paints several cells per frame.
      pickedRef.current = next;
      setPicked(next);
      setError(null);
      const map = new Map<string, Set<number>>();
      next.forEach((k) => {
        const [day, slot] = k.split(':');
        if (!map.has(day!)) map.set(day!, new Set());
        map.get(day!)!.add(Number(slot));
      });
      onAnswer(encodeAvailability(grid, map));
    },
    [grid, onAnswer],
  );

  const setCells = useCallback(
    (keys: string[], mode: 'add' | 'remove') => {
      const next = new Set(pickedRef.current);
      let changed = false;
      for (const k of keys) {
        if (mode === 'add' && !next.has(k)) {
          next.add(k);
          changed = true;
        } else if (mode === 'remove' && next.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      if (changed) commit(next);
    },
    [commit],
  );

  /** The cell under a point, from the grid's own layout (uniform cells). */
  const cellAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest<HTMLElement>('[data-cell]')?.dataset.cell;
    return k && gridRef.current?.contains(el) ? k : null;
  };

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell;
    if (!k || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const mode = pickedRef.current.has(k) ? 'remove' : 'add';
    const touch = e.pointerType === 'touch';
    const p = {
      id: e.pointerId,
      mode,
      touch,
      active: !touch,
      x0: e.clientX,
      y0: e.clientY,
      timer: 0,
      start: k,
      last: k,
    } as NonNullable<typeof paint.current>;
    paint.current = p;
    if (!touch) {
      e.preventDefault();
      try {
        gridRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a nicety */
      }
      setCells([k], mode);
      ping?.();
    } else {
      const held = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
      held?.classList.add('is-pressing');
      p.pressing = held;
      p.timer = window.setTimeout(() => {
        held?.classList.remove('is-pressing');
        if (paint.current !== p) return;
        p.active = true;
        setCells([k], mode);
        ping?.();
        navigator.vibrate?.(8);
      }, HOLD_MS);
    }
  };

  const extend = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = paint.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.active) {
      const dx = Math.abs(e.clientX - p.x0);
      const dy = Math.abs(e.clientY - p.y0);
      if (dx < 8 && dy < 8) return;
      // A sideways drag paints now; a vertical one is a scroll.
      window.clearTimeout(p.timer);
      unpress(p);
      if (dx > dy * 1.4) {
        p.active = true;
        if (p.start) setCells([p.start], p.mode);
      } else {
        paint.current = null;
        return;
      }
    }
    const k = cellAt(e.clientX, e.clientY);
    if (!k || k === p.last) return;
    setCells(p.last ? cellsBetween(p.last, k) : [k], p.mode);
    p.last = k;
  };

  /** Every cell on the straight line from `a` to `b` (grid steps), both ends included. */
  const cellsBetween = (a: string, b: string): string[] => {
    const at = (k: string) => {
      const [day, slot] = k.split(':');
      return [grid.days.indexOf(day!), Number(slot)] as const;
    };
    const [d0, s0] = at(a);
    const [d1, s1] = at(b);
    if (d0 < 0 || d1 < 0) return [b];
    const n = Math.max(Math.abs(d1 - d0), Math.abs(s1 - s0));
    const out: string[] = [];
    for (let i = 0; i <= n; i++) {
      const d = Math.round(d0 + ((d1 - d0) * i) / (n || 1));
      const sl = Math.round(s0 + ((s1 - s0) * i) / (n || 1));
      out.push(cellKey(grid.days[d]!, sl));
    }
    return out;
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = paint.current;
    if (!p || p.id !== e.pointerId) return;
    window.clearTimeout(p.timer);
    unpress(p);
    paint.current = null;
    // A quick tap on touch toggles the one cell.
    if (p.touch && !p.active && p.start && e.type === 'pointerup') {
      setCells([p.start], p.mode);
      ping?.();
    }
  };

  // While painting on touch, stop the page from scrolling under the finger.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const stop = (ev: TouchEvent) => {
      if (paint.current?.active && ev.cancelable) ev.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    return () => el.removeEventListener('touchmove', stop);
  }, []);

  const fillDay = (day: string) => {
    const keys = Array.from({ length: grid.count }, (_, s) => cellKey(day, s));
    const all = keys.every((k) => pickedRef.current.has(k));
    setCells(keys, all ? 'remove' : 'add');
    ping?.();
    setSaid(`${WEEKDAY_LONG[day] ?? day} ${all ? 'cleared' : 'all free'}.`);
  };

  const fillRow = (slot: number) => {
    const keys = grid.days.map((d) => cellKey(d, slot));
    const all = keys.every((k) => pickedRef.current.has(k));
    setCells(keys, all ? 'remove' : 'add');
    ping?.();
    setSaid(`${clockLabel(grid.start + slot * grid.slot)} ${all ? 'cleared' : 'free every day'}.`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const mv = moves[e.key];
    const here = cellKey(grid.days[focus.d]!, focus.s);
    if (mv) {
      e.preventDefault();
      const d = Math.min(grid.days.length - 1, Math.max(0, focus.d + mv[0]));
      const s = Math.min(grid.count - 1, Math.max(0, focus.s + mv[1]));
      if (e.shiftKey)
        setCells([here, cellKey(grid.days[d]!, s)], pickedRef.current.has(here) ? 'add' : 'remove');
      setFocus({ d, s });
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-cell="${cellKey(grid.days[d]!, s)}"]`)
        ?.focus();
    } else if (e.key === ' ') {
      e.preventDefault();
      setCells([here], pickedRef.current.has(here) ? 'remove' : 'add');
      ping?.();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const s = e.key === 'Home' ? 0 : grid.count - 1;
      setFocus({ d: focus.d, s });
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-cell="${cellKey(grid.days[focus.d]!, s)}"]`)
        ?.focus();
    }
  };

  const submit = useCallback(() => {
    const map = new Map<string, Set<number>>();
    pickedRef.current.forEach((k) => {
      const [day, slot] = k.split(':');
      if (!map.has(day!)) map.set(day!, new Set());
      map.get(day!)!.add(Number(slot));
    });
    const answer = encodeAvailability(grid, map);
    const err = validate(question, answer);
    if (err) {
      setError(err.message);
      shakeInvalid(gridRef.current);
      return;
    }
    setError(null);
    onAnswer(answer);
    onAdvance();
  }, [grid, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const daysFree = grid.days.filter((d) => [...picked].some((k) => k.startsWith(`${d}:`)));
  // Label every slot when they're an hour or longer; otherwise only on the hour.
  const labelEvery = grid.slot >= 60 ? 1 : 60 / grid.slot;

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <p className="slate-subtitle slate-avail-lede">
        Tap or drag to paint the times you’re free. Tap a day to fill it.
        <span className="slate-touch-note"> On a phone, hold a moment before you drag.</span>
      </p>

      <div className="slate-avail">
        <div
          ref={gridRef}
          className="slate-avail-grid"
          role="grid"
          aria-labelledby={titleId}
          aria-describedby={error ? `${howId} ${titleId}-err` : howId}
          aria-multiselectable="true"
          style={{ '--slate-days': grid.days.length } as CSSProperties}
          onPointerDown={begin}
          onPointerMove={extend}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={onKey}
        >
          <div className="slate-avail-row slate-avail-row--head" role="row">
            <span className="slate-avail-corner" role="columnheader" aria-label="Time" />
            {grid.days.map((d) => (
              <span key={d} role="columnheader" className="slate-avail-dayhead">
                <button
                  type="button"
                  className="slate-avail-day"
                  tabIndex={-1}
                  aria-label={`Fill or clear ${WEEKDAY_LONG[d] ?? d}`}
                  onClick={() => fillDay(d)}
                >
                  {WEEKDAY_SHORT[d] ?? d}
                </button>
              </span>
            ))}
          </div>
          {Array.from({ length: grid.count }, (_, s) => {
            const t = grid.start + s * grid.slot;
            const showLabel = s % labelEvery === 0;
            return (
              <div
                key={s}
                role="row"
                className={`slate-avail-row${showLabel ? ' slate-avail-row--hour' : ''}`}
              >
                <span role="rowheader" className="slate-avail-timehead">
                  <button
                    type="button"
                    className="slate-avail-time"
                    tabIndex={-1}
                    aria-label={`Fill or clear ${clockLabel(t)} on every day`}
                    onClick={() => fillRow(s)}
                  >
                    {showLabel ? clockLabel(t) : ''}
                  </button>
                </span>
                {grid.days.map((d, di) => {
                  const k = cellKey(d, s);
                  const on = picked.has(k);
                  return (
                    <span
                      key={k}
                      role="gridcell"
                      data-cell={k}
                      aria-selected={on}
                      aria-label={`${WEEKDAY_LONG[d] ?? d} ${clockLabel(t)} to ${clockLabel(t + grid.slot)}`}
                      tabIndex={focus.d === di && focus.s === s ? 0 : -1}
                      className={`slate-avail-cell${on ? ' is-on' : ''}`}
                      onFocus={() => setFocus({ d: di, s })}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
        <p id={howId} className="slate-sr">
          Arrow keys move between times, Space marks a time free or busy, Shift with an arrow key
          paints as you move.
        </p>

        <div className="slate-avail-meta">
          <span className="slate-avail-sum" role="status">
            {picked.size === 0
              ? 'Nothing painted yet'
              : `${freeTime(picked.size * grid.slot)} free · ${daysFree
                  .map((d) => WEEKDAY_SHORT[d] ?? d)
                  .join(', ')}`}
          </span>
          {picked.size > 0 ? (
            <button
              type="button"
              className="slate-avail-clear"
              onClick={() => {
                commit(new Set());
                setSaid('All times cleared.');
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
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
