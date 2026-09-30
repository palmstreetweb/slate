/**
 * Swipe cards (ADR-065), loaded on demand. Two looks for answers that already
 * exist, so they are options, not types:
 *
 *   - picture choice, `display: 'swipe'` with `multiple: true` — a card stack;
 *     swipe right (or →, or ♥) to like, left (←, ✕) to pass. The answer is the
 *     same list of picked option values the grid stores: the liked ones.
 *   - yes / no, `display: 'swipe'` — one "this or that" card holding the
 *     question; right is yes, left is no. The answer is 'yes' / 'no'.
 *
 * Swiping is never the only way: the ✕ / ♥ buttons and the arrow keys do the
 * same, and every decision is announced. The card follows the finger (it is
 * direct manipulation), tilts, stamps LIKE / NOPE, and flings off with a
 * little physics; calm motion keeps the follow but drops the tilt and the
 * fling, and the next card simply appears.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { PictureChoiceQuestion, YesNoQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { motionReduced, shakeInvalid } from '@/utils/motion.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';
import '@/styles/extensions-c.css';

type Dir = 'like' | 'nope';

/** How far past which a released card counts as a decision, in px (or 30% of the card). */
const DECIDE_PX = 110;
/** A quick flick counts too: px per ms, over at least this far. */
const FLICK_SPEED = 0.55;
const FLICK_MIN_PX = 28;

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** Keep a finished fling where it ended, so the question hand-off copy (ADR-059) doesn't show the card back. */
function park(el: HTMLElement, transform: string) {
  el.style.transform = transform;
  el.style.opacity = '0';
}

/**
 * Drag, tilt and fling for the top card. Returns pointer handlers for the
 * card and `fling(dir)` for the buttons and keys; `onDecided` runs once the
 * card has left (at once with calm motion).
 */
function useSwipeCard(onDecided: (dir: Dir) => void) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    id: number;
    x0: number;
    y0: number;
    dx: number;
    samples: Array<[number, number]>;
    moved: boolean;
  } | null>(null);
  const busy = useRef(false);

  const setLean = (el: HTMLElement, dx: number) => {
    const like = Math.max(0, Math.min(1, dx / 90));
    const nope = Math.max(0, Math.min(1, -dx / 90));
    el.style.setProperty('--slate-swipe-like', like.toFixed(3));
    el.style.setProperty('--slate-swipe-nope', nope.toFixed(3));
  };

  const place = (el: HTMLElement, dx: number, dy: number) => {
    const calm = motionReduced(el);
    el.style.transform = calm
      ? `translate3d(${dx}px, 0, 0)`
      : `translate3d(${dx}px, ${dy * 0.2}px, 0) rotate(${dx * 0.055}deg)`;
    setLean(el, dx);
  };

  const reset = (el: HTMLElement) => {
    el.style.transform = '';
    el.style.opacity = '';
    setLean(el, 0);
  };

  const fling = useCallback(
    (dir: Dir) => {
      const el = cardRef.current;
      if (busy.current) return;
      busy.current = true;
      const done = () => {
        busy.current = false;
        onDecided(dir);
      };
      if (!el) {
        done();
        return;
      }
      const sign = dir === 'like' ? 1 : -1;
      setLean(el, sign * 90);
      const width = el.getBoundingClientRect().width || 320;
      const to = `translate3d(${sign * width * 1.45}px, -24px, 0) rotate(${sign * 24}deg)`;
      if (motionReduced(el) || typeof el.animate !== 'function') {
        park(el, to);
        done();
        return;
      }
      const from = el.style.transform || 'translate3d(0, 0, 0) rotate(0deg)';
      const anim = el.animate(
        [
          { transform: from, opacity: 1 },
          { transform: to, opacity: 0 },
        ],
        { duration: 300, easing: 'cubic-bezier(0.45, 0, 0.9, 0.6)', fill: 'forwards' },
      );
      // Whichever comes first: the fling ends, or a backstop (a background tab
      // throttles animations; the decision must never wait on them).
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(backstop);
        park(el, to);
        anim.cancel();
        done();
      };
      const backstop = window.setTimeout(finish, 420);
      anim.finished.then(finish, finish);
    },
    [onDecided],
  );

  const springBack = (el: HTMLElement) => {
    const from = el.style.transform;
    reset(el);
    if (!from || motionReduced(el) || typeof el.animate !== 'function') return;
    el.animate([{ transform: from }, { transform: 'translate3d(0, 0, 0) rotate(0deg)' }], {
      duration: 420,
      easing: 'cubic-bezier(0.2, 1.5, 0.4, 1)',
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      samples: [[e.timeStamp, e.clientX]],
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    d.dx = dx;
    d.samples.push([e.timeStamp, e.clientX]);
    if (d.samples.length > 6) d.samples.shift();
    place(e.currentTarget, dx, dy);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    const el = e.currentTarget;
    const [t0, x0] = d.samples[0]!;
    const [t1, x1] = d.samples[d.samples.length - 1]!;
    const speed = t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
    const far = Math.min(DECIDE_PX, el.getBoundingClientRect().width * 0.3);
    if (Math.abs(d.dx) > far || (Math.abs(speed) > FLICK_SPEED && Math.abs(d.dx) > FLICK_MIN_PX)) {
      fling(d.dx > 0 ? 'like' : 'nope');
    } else {
      springBack(el);
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    springBack(e.currentTarget);
  };

  return {
    cardRef,
    fling,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}

/** ← / → decide while this field is on screen (not while typing somewhere else). */
function useArrowKeys(onKey: (dir: Dir) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        onKey(e.key === 'ArrowRight' ? 'like' : 'nope');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onKey, enabled]);
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Stamps({ like, nope }: { like: string; nope: string }) {
  return (
    <>
      <span className="slate-swipe-stamp slate-swipe-stamp--like" aria-hidden="true">
        {like}
      </span>
      <span className="slate-swipe-stamp slate-swipe-stamp--nope" aria-hidden="true">
        {nope}
      </span>
    </>
  );
}

/* ---------- picture choice: a stack of cards ---------- */

function PictureSwipe({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  ping,
}: ExtFieldProps<PictureChoiceQuestion>) {
  const titleId = useId();
  const options = question.options;
  const seeded = Array.isArray(value) ? (value as string[]) : null;
  const [decisions, setDecisions] = useState<Dir[]>(() =>
    seeded ? options.map((o) => (seeded.includes(o.value) ? 'like' : 'nope')) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const deckRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const index = decisions.length;
  const done = index >= options.length;
  const liked = options.filter((_, i) => decisions[i] === 'like');

  useEffect(
    () => focusAfter(done ? okRef.current : deckRef.current),
    // Once per question, and when the deck runs out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question.id, done],
  );

  const decide = useCallback(
    (dir: Dir) => {
      const card = options[decisions.length];
      if (!card) return;
      ping?.();
      const next = [...decisions, dir];
      setDecisions(next);
      setError(null);
      const upcoming = options[next.length];
      setSaid(
        `${dir === 'like' ? 'Liked' : 'Passed on'} ${card.label}.${
          upcoming ? ` Card ${next.length + 1} of ${options.length}: ${upcoming.label}.` : ''
        }`,
      );
      if (next.length >= options.length) {
        onAnswer(options.filter((_, i) => next[i] === 'like').map((o) => o.value));
      }
    },
    [options, decisions, onAnswer, ping],
  );

  const { cardRef, fling, handlers } = useSwipeCard(decide);
  useArrowKeys(fling, !done);

  const undo = () => {
    if (decisions.length === 0) return;
    const back = decisions.slice(0, -1);
    setDecisions(back);
    setError(null);
    onAnswer(undefined);
    setSaid(`Back to ${options[back.length]?.label ?? 'the last card'}.`);
  };

  const again = () => {
    setDecisions([]);
    setError(null);
    onAnswer(undefined);
    setSaid(`Starting over. Card 1 of ${options.length}: ${options[0]?.label ?? ''}.`);
  };

  const submit = useCallback(() => {
    if (!done) {
      setError('Swipe through every card first');
      shakeInvalid(deckRef.current);
      return;
    }
    const picks = liked.map((o) => o.value);
    const err = validate(question, picks);
    if (err) {
      setError(err.message);
      shakeInvalid(okRef.current);
      return;
    }
    onAnswer(picks);
    onAdvance();
  }, [done, liked, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const current = options[index];
  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      {!done ? (
        <>
          <div
            ref={deckRef}
            className="slate-swipe"
            role="group"
            aria-roledescription="card stack"
            aria-labelledby={titleId}
            aria-describedby={`${titleId}-how`}
            tabIndex={-1}
          >
            <p className="slate-swipe-count" aria-hidden="true">
              {index + 1} / {options.length}
            </p>
            <div className="slate-swipe-deck">
              {options
                .slice(index, index + 3)
                .map((opt, depth) => {
                  const top = depth === 0;
                  return (
                    <div
                      key={opt.value}
                      ref={top ? cardRef : undefined}
                      className={`slate-swipe-card${top ? ' slate-swipe-card--top' : ''}`}
                      style={{ '--slate-swipe-depth': depth } as CSSProperties}
                      aria-hidden={top ? undefined : true}
                      {...(top ? handlers : {})}
                    >
                      <img
                        className="slate-swipe-img"
                        src={opt.src}
                        alt={top ? (opt.alt ?? opt.label) : ''}
                        draggable={false}
                        referrerPolicy="no-referrer"
                      />
                      <span className="slate-swipe-caption">
                        <span className="slate-swipe-label">{opt.label}</span>
                        {opt.description ? (
                          <span className="slate-swipe-desc">{opt.description}</span>
                        ) : null}
                      </span>
                      {top ? <Stamps like="LIKE" nope="NOPE" /> : null}
                    </div>
                  );
                })
                .reverse()}
            </div>
            <p id={`${titleId}-how`} className="slate-sr">
              {`Card ${index + 1} of ${options.length}: ${current?.label ?? ''}. Swipe right or press the right arrow to like it, left to pass.`}
            </p>
          </div>
          <div className="slate-swipe-actions">
            <button
              type="button"
              className="slate-swipe-btn slate-swipe-btn--nope"
              aria-label={`Pass on ${current?.label ?? 'this card'}`}
              aria-keyshortcuts="ArrowLeft"
              onClick={() => fling('nope')}
            >
              <CrossIcon />
            </button>
            <button
              type="button"
              className="slate-swipe-undo"
              onClick={undo}
              disabled={index === 0}
            >
              Undo
            </button>
            <button
              type="button"
              className="slate-swipe-btn slate-swipe-btn--like"
              aria-label={`Like ${current?.label ?? 'this card'}`}
              aria-keyshortcuts="ArrowRight"
              onClick={() => fling('like')}
            >
              <HeartIcon />
            </button>
          </div>
          <p className="slate-hint slate-swipe-hint">swipe, tap ✕ / ♥, or use ← →</p>
        </>
      ) : (
        <div className="slate-swipe-done">
          <p className="slate-swipe-done-title">
            {liked.length === 0
              ? 'None of these? That’s an answer too.'
              : `You liked ${liked.length} of ${options.length}`}
          </p>
          {liked.length > 0 ? (
            <ul className="slate-swipe-liked" aria-label="Your likes">
              {liked.map((o, i) => (
                <li
                  key={o.value}
                  className="slate-swipe-liked-item"
                  style={{ '--slate-i': i } as CSSProperties}
                >
                  <img src={o.src} alt="" referrerPolicy="no-referrer" draggable={false} />
                  <span>{o.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="slate-swipe-again" onClick={again}>
            Swipe again
          </button>
        </div>
      )}

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
      {error ? (
        <p className="slate-err" aria-live="polite">
          ! {error}
        </p>
      ) : null}
      {done ? (
        <div className="slate-actions">
          <button ref={okRef} type="button" className="slate-ok-btn" onClick={submit}>
            OK <span aria-hidden>✓</span>
          </button>
          <span className="slate-hint">press Enter ↵</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- yes / no: one "this or that" card ---------- */

function YesNoSwipe({ question, answers, value, onCommit }: ExtFieldProps<YesNoQuestion>) {
  const titleId = useId();
  const yes = question.yesLabel ?? 'Yes';
  const no = question.noLabel ?? 'No';
  const answered = value === 'yes' || value === 'no' ? value : null;
  const [said, setSaid] = useState('');
  const mine = useRef<string | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  const decide = useCallback(
    (dir: Dir) => {
      const v = dir === 'like' ? 'yes' : 'no';
      mine.current = v;
      setSaid(v === 'yes' ? yes : no);
      onCommit(v);
    },
    [onCommit, yes, no],
  );

  const { cardRef, fling, handlers } = useSwipeCard(decide);
  useArrowKeys(fling, true);
  useEffect(() => focusAfter(groupRef.current), [question.id]);

  // Y / N (through <Form>) answer without touching the card: fling it the same way.
  const seen = useRef(answered);
  useEffect(() => {
    if (answered && answered !== seen.current && answered !== mine.current) {
      const el = cardRef.current;
      if (el) {
        const sign = answered === 'yes' ? 1 : -1;
        park(el, `translate3d(${sign * 140}%, -24px, 0) rotate(${sign * 24}deg)`);
      }
      setSaid(answered === 'yes' ? yes : no);
    }
    seen.current = answered;
  }, [answered, cardRef, yes, no]);

  return (
    <div
      ref={groupRef}
      className="slate-swipe slate-swipe--single"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-how`}
      tabIndex={-1}
    >
      <div className="slate-swipe-deck slate-swipe-deck--single">
        <div
          ref={cardRef}
          className="slate-swipe-card slate-swipe-card--top slate-swipe-card--text"
          {...handlers}
        >
          <h1 id={titleId} className="slate-title slate-swipe-question">
            {resolveTitle(question.title, answers)}
          </h1>
          <span className="slate-swipe-sides" aria-hidden="true">
            <span>← {no}</span>
            <span>{yes} →</span>
          </span>
          {answered ? (
            <span className="slate-swipe-was" aria-hidden="true">
              You said {answered === 'yes' ? yes : no}
            </span>
          ) : null}
          <Stamps like={yes.toUpperCase()} nope={no.toUpperCase()} />
        </div>
      </div>
      <p id={`${titleId}-how`} className="slate-sr">
        {`Swipe right or press the right arrow for ${yes}, left for ${no}. Or press Y or N.`}
      </p>
      <div className="slate-swipe-actions">
        <button
          type="button"
          className="slate-swipe-btn slate-swipe-btn--nope"
          aria-keyshortcuts="ArrowLeft N"
          aria-pressed={answered === 'no'}
          onClick={() => fling('nope')}
        >
          <CrossIcon />
          <span className="slate-swipe-btn-text">{no}</span>
        </button>
        <button
          type="button"
          className="slate-swipe-btn slate-swipe-btn--like"
          aria-keyshortcuts="ArrowRight Y"
          aria-pressed={answered === 'yes'}
          onClick={() => fling('like')}
        >
          <CheckIcon />
          <span className="slate-swipe-btn-text">{yes}</span>
        </button>
      </div>
      <p className="slate-hint slate-swipe-hint">swipe, tap, or press Y / N</p>
      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

export default function SwipeField(props: ExtFieldProps) {
  return props.question.type === 'yes_no' ? (
    <YesNoSwipe {...(props as ExtFieldProps<YesNoQuestion>)} />
  ) : (
    <PictureSwipe {...(props as ExtFieldProps<PictureChoiceQuestion>)} />
  );
}
