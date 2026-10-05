/**
 * Sign-up slots (ADR-066), loaded on demand. The owner lists slots with a
 * capacity ("Sat 10–11am, 8 spots"); the respondent sees what's left and
 * takes one — or up to `maxPicks` — and, when the owner allows it, joins the
 * waitlist of a full one. Slots with a date are grouped under their day.
 *
 * Spots left come from the host (`<Form slotsLeft>`): the fill page passes
 * what the server counted when the form loaded, and fresh counts when a slot
 * fills during a submit (the server takes the spot in the same transaction as
 * the response, so a slot never holds more than its capacity). A slot the
 * respondent picked that the latest count says is full reads "Just filled
 * up" until they pick another — every other answer stays.
 *
 * Each slot is a `.slate-choice` button, so every theme's choice look carries
 * over. Letter keys pick slots; one pick commits and moves on (the choice
 * commit beat), several wait for OK. Grabbing the last spot gets its own
 * moment: the meter fills, a stamp lands and a few sparks fly (calm motion
 * shows the stamp, still).
 *
 * A tap that can't be taken (a full slot, or one past the most picks) is
 * answered right under that slot, not at the foot of a long list (QA
 * GAP-16). When every slot is full and there's no waitlist, the question
 * says so and OK moves on without a pick, so nobody is stuck (QA MEDIA-07).
 */

'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { SignupSlot, SignupSlotsQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { signupMaxPicks, signupPicks } from '@/logic/signup.js';
import {
  offeredSlots,
  remainingText,
  slotDays,
  slotName,
  slotTimeText,
  slotDayLabel,
  spotsLeft,
} from '@/logic/signupView.js';
import { useChoiceCommit } from '@/hooks/useChoiceCommit.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { motionReduced, shakeInvalid } from '@/utils/motion.js';
import { ChoiceBadge } from '../ChoiceBadge.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';
import '@/styles/extensions-d.css';

type Answer = { slots: string[]; wait?: string[] };

/** How long the last-spot moment holds before a single pick moves on. */
const LAST_SPOT_MS = 1100;
/**
 * A–Z, one key per slot (ADR-042). Spelled out here rather than imported from
 * utils/letters.ts, so this chunk doesn't split a core chunk in two.
 */
const letterOf = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : '');
const indexOfKey = (key: string): number => {
  const c = key.length === 1 ? key.toUpperCase().charCodeAt(0) - 65 : -1;
  return c >= 0 && c < 26 ? c : -1;
};

/** Sparks around the last-spot stamp: fixed angles, no randomness (ADR-059). */
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function answerOf(slots: string[], wait: string[]): Answer | undefined {
  if (!slots.length && !wait.length) return undefined;
  return wait.length ? { slots, wait } : { slots };
}

export default function SignupSlotsField({
  question,
  answers,
  value,
  onAnswer,
  onCommit,
  onAdvance,
  onAdvanceSilent,
  ping,
  slotsLeft,
}: ExtFieldProps<SignupSlotsQuestion>) {
  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const slots = useMemo(() => offeredSlots(question), [question]);
  const days = useMemo(() => slotDays(slots), [slots]);
  const max = signupMaxPicks(question as unknown as Record<string, unknown>, slots.length);
  const single = max === 1;
  const waitlist = question.waitlist === true;
  const showLeft = question.showRemaining !== false;
  const picks = signupPicks(value);
  const selectedOne = single ? (picks.slots[0] ?? picks.wait[0]) : undefined;
  const { committed, markCommitted } = useChoiceCommit(selectedOne);
  const [error, setError] = useState<string | null>(null);
  /** A tap that couldn't be taken, answered under that slot. */
  const [note, setNote] = useState<{ slot: string; text: string } | null>(null);
  const [said, setSaid] = useState('');
  /** The slot whose last spot was just taken here (the celebration plays once). */
  const [lastGrab, setLastGrab] = useState<string | null>(null);
  const advanceTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

  const stateOf = useCallback(
    (s: SignupSlot) => {
      const left = spotsLeft(slotsLeft, s);
      const taken = picks.slots.includes(s.value);
      const waiting = picks.wait.includes(s.value);
      const full = left === 0;
      const conflict = taken && full;
      // What's left once this respondent's own pick counts.
      const shown = left === undefined ? undefined : taken && !conflict ? left - 1 : left;
      return { left, taken, waiting, full, conflict, shown };
    },
    [slotsLeft, picks.slots, picks.wait],
  );

  const conflicts = slots.filter((s) => stateOf(s).conflict);
  // Every spot gone and no waitlist: nothing can be picked, so nothing is asked
  // for. A pick of this respondent's that filled up meanwhile counts as gone too.
  const allFull = !waitlist && slots.length > 0 && slots.every((s) => stateOf(s).full);

  const clearAdvance = () => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };

  /** Say why a tap can't be taken, right under the slot tapped. */
  const refuse = (s: SignupSlot, text: string) => {
    setError(null);
    setNote({ slot: s.value, text }); // the note is its own polite live region
    // Offered slot values are letters, digits, _ and - (SLOT_VALUE_RE): safe in a selector.
    shakeInvalid(listRef.current?.querySelector(`[data-slot="${s.value}"]`));
  };

  const choose = (s: SignupSlot) => {
    const st = stateOf(s);
    const name = slotName(s);
    setError(null);
    setNote(null);
    clearAdvance();

    // Picked, but it filled up meanwhile: tapping it lets it go.
    if (st.conflict) {
      onAnswer(
        answerOf(
          picks.slots.filter((v) => v !== s.value),
          picks.wait,
        ),
      );
      setSaid(`${name} removed. Pick another.`);
      return;
    }
    if (st.taken || st.waiting) {
      if (single) {
        // Same pick again: move on, like a single choice.
        markCommitted(s.value);
        onCommit(value);
        return;
      }
      onAnswer(
        answerOf(
          picks.slots.filter((v) => v !== s.value),
          picks.wait.filter((v) => v !== s.value),
        ),
      );
      setSaid(st.waiting ? `Left the waitlist for ${name}.` : `${name} removed.`);
      return;
    }
    if (st.full && !waitlist) {
      refuse(s, allFull ? 'Sorry, every spot is taken.' : `${name} is full. Please pick another.`);
      return;
    }
    const joinWait = st.full;
    if (!single && picks.slots.length + picks.wait.length >= max) {
      refuse(s, `You can pick up to ${max}. Tap one of your picks to let it go.`);
      return;
    }
    const next = single
      ? joinWait
        ? answerOf([], [s.value])
        : answerOf([s.value], [])
      : joinWait
        ? answerOf(picks.slots, [...picks.wait, s.value])
        : answerOf([...picks.slots, s.value], picks.wait);
    const last = !joinWait && st.left === 1;
    if (last) setLastGrab(s.value);
    setSaid(
      joinWait
        ? `You joined the waitlist for ${name}.`
        : last
          ? `You got the last spot: ${name}.`
          : `You're in: ${name}.`,
    );
    if (!single) {
      ping?.();
      onAnswer(next);
      return;
    }
    markCommitted(s.value);
    if (last && !motionReduced(listRef.current)) {
      // Hold on the last-spot moment a little longer, then move on.
      ping?.();
      onAnswer(next);
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = null;
        (onAdvanceSilent ?? onAdvance)();
      }, LAST_SPOT_MS);
      return;
    }
    onCommit(next);
  };

  const submit = useCallback(() => {
    clearAdvance();
    setNote(null);
    if (allFull) {
      // Nothing left to pick: the rest of the form can still be sent. A pick
      // that filled up meanwhile can't be kept (the server would refuse it).
      if (picks.slots.length) onAnswer(undefined);
      setError(null);
      onAdvance();
      return;
    }
    if (conflicts.length) {
      setError(
        `${slotName(conflicts[0])} just filled up. Please pick another${waitlist ? ', or join its waitlist' : ''}.`,
      );
      shakeInvalid(listRef.current);
      return;
    }
    const answer = answerOf(picks.slots, picks.wait);
    const err = validate(question, answer);
    if (err) {
      setError(err.message);
      shakeInvalid(listRef.current);
      return;
    }
    setError(null);
    onAdvance();
  }, [conflicts, picks.slots, picks.wait, question, waitlist, onAdvance, onAnswer, allFull]);

  useRegisterFormConfirm(submit);

  // Letter keys pick slots, in the order shown (the deck-style ownership of Wave C).
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const i = indexOfKey(e.key);
      const s = i >= 0 ? slots[i] : undefined;
      if (!s) return;
      e.preventDefault();
      chooseRef.current(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slots]);

  const title = resolveTitle(question.title, answers);
  const hint = allFull
    ? 'Sorry, every spot is taken. You can still send the rest.'
    : single
      ? 'Pick one'
      : `Pick up to ${max}`;
  let index = -1;

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {title}
      </h1>
      {question.body ? <p className="slate-subtitle slate-slots-body">{question.body}</p> : null}
      <p className="slate-slots-hint" role={allFull ? 'status' : undefined}>
        {hint}
        {waitlist ? ' · full ones have a waitlist' : ''}
      </p>

      <div
        ref={listRef}
        className={`slate-slots${single && committed ? ' slate-choices--committed' : ''}`}
        role={single ? 'radiogroup' : 'group'}
        aria-labelledby={titleId}
      >
        {days.map((group, g) => (
          <div
            key={`${group.day}-${g}`}
            className="slate-slot-day"
            role={group.day ? 'group' : undefined}
            aria-label={group.day || undefined}
          >
            {group.day ? (
              <p className="slate-slot-day-label" aria-hidden="true">
                {group.day}
              </p>
            ) : null}
            {group.slots.map((s) => {
              index += 1;
              const i = index;
              const st = stateOf(s);
              const name = slotName(s);
              const time = slotTimeText(s);
              const secondary = s.label?.trim() ? time : '';
              const isCommitted = single && committed === s.value && (st.taken || st.waiting);
              const last = st.taken && !st.conflict && st.left === 1;
              const status = st.conflict
                ? 'Just filled up'
                : st.waiting
                  ? 'On the waitlist'
                  : st.taken
                    ? last
                      ? 'You got the last spot'
                      : 'You’re in'
                    : st.full
                      ? waitlist
                        ? 'Full · join the waitlist'
                        : 'Full'
                      : showLeft
                        ? remainingText(st.left, s.capacity)
                        : '';
              const count =
                st.taken && !st.conflict && showLeft && st.shown !== undefined && st.shown > 0
                  ? remainingText(st.shown, s.capacity)
                  : '';
              const fill =
                st.left === undefined ? 0 : (s.capacity - (st.shown ?? st.left)) / s.capacity;
              const blocked = st.full && !waitlist && !st.taken;
              const label = [
                name,
                secondary,
                slotDayLabel(s.date) && !group.day ? slotDayLabel(s.date) : '',
                status,
                count,
              ]
                .filter(Boolean)
                .join(', ');
              const descId = s.description ? `${titleId}-d${i}` : undefined;
              return (
                <Fragment key={s.value}>
                  <button
                    data-slot={s.value}
                    type="button"
                    role={single ? 'radio' : 'checkbox'}
                    aria-checked={st.taken || st.waiting}
                    aria-disabled={blocked || undefined}
                    aria-label={label}
                    aria-describedby={descId}
                    onClick={() => choose(s)}
                    className={[
                      'slate-choice slate-slot',
                      // A pick that filled up reads as a problem, not as chosen.
                      (st.taken && !st.conflict) || st.waiting ? 'slate-choice--selected' : '',
                      isCommitted ? 'slate-choice--committed' : '',
                      st.full && !st.taken ? 'slate-slot--full' : '',
                      st.waiting ? 'slate-slot--waiting' : '',
                      st.conflict ? 'slate-slot--conflict' : '',
                      last ? 'slate-slot--last' : '',
                      last && lastGrab === s.value ? 'slate-slot--grabbed' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ '--slate-i': i, '--slate-fill': fill } as CSSProperties}
                  >
                    {single ? (
                      <ChoiceBadge letter={letterOf(i)} committed={isCommitted} />
                    ) : (
                      <span className="slate-choice-badge" aria-hidden="true">
                        {st.taken || st.waiting ? (
                          <svg className="slate-slot-tick" viewBox="0 0 24 24" focusable="false">
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        ) : (
                          letterOf(i)
                        )}
                      </span>
                    )}
                    <span className="slate-slot-main" aria-hidden="true">
                      <span className="slate-slot-name">{name}</span>
                      {secondary ? <span className="slate-slot-when">{secondary}</span> : null}
                      {s.description ? (
                        <span id={descId} className="slate-slot-desc">
                          {s.description}
                        </span>
                      ) : null}
                    </span>
                    <span className="slate-slot-side" aria-hidden="true">
                      {status ? <span className="slate-slot-status">{status}</span> : null}
                      {count ? <span className="slate-slot-count">{count}</span> : null}
                      {st.left !== undefined && showLeft ? (
                        <span className="slate-slot-meter">
                          <span className="slate-slot-meter-fill" />
                        </span>
                      ) : null}
                    </span>
                    {last ? (
                      <span className="slate-slot-stamp" aria-hidden="true">
                        Last spot!
                        {SPARKS.map((a) => (
                          <span
                            key={a}
                            className="slate-slot-spark"
                            style={{ '--slate-a': `${a}deg` } as CSSProperties}
                          />
                        ))}
                      </span>
                    ) : null}
                  </button>
                  {note?.slot === s.value ? (
                    <p className="slate-err slate-slot-note" aria-live="polite">
                      ! {note.text}
                    </p>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        ))}
      </div>

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
      {error ? (
        <p className="slate-err" aria-live="polite">
          ! {error}
        </p>
      ) : null}
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-key-hint">
          {slots.length > 1
            ? `press A–${letterOf(Math.min(slots.length, 26) - 1)}, or click to choose`
            : slots.length
              ? 'press A, or click to choose'
              : ''}
        </span>
      </div>
    </div>
  );
}
