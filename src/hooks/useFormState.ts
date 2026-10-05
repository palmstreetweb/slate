/**
 * The form engine state machine.
 *
 * Owns: step (into visible questions), answers (full record incl. hidden),
 * history (back-nav stack), animation direction, and visited IDs.
 *
 * Surfaces only navigation + answer-setting primitives. Submission flow
 * (calling the user's onSubmit, tracking submit status) lives in Form.tsx
 * because it needs the user's onSubmit callback.
 *
 * See BUILD_BRIEF.md §10.1 + ADR-005 (retain-but-exclude semantics).
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Schema } from '@/types/Schema.js';
import type { Question } from '@/types/Question.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { isChrome, pathOf, visibleQuestions } from '@/logic/progress.js';
import { otherIndex } from '@/logic/other.js';
import { areaIndex } from '@/logic/address.js';

export type AnimDirection = 'forward' | 'backward';

export type FormState = {
  /** Current index into the visible-questions list. */
  step: number;
  /** The visible-questions list (chrome screens included). */
  visible: Question[];
  /**
   * The visible questions on the respondent's path (ADR-069), in order:
   * what `getSubmitAnswers` sends and what the Review step lists.
   */
  path: Question[];
  /** All answers, including those for now-hidden questions (per ADR-005). */
  answers: LooseAnswers;
  /** Stack of question IDs for back navigation. */
  history: string[];
  /** Last navigation direction, used by the transition layer. */
  direction: AnimDirection;
  /** True between transition start and end. */
  isAnimating: boolean;
  /** Form session start time (set once on mount). */
  startedAt: Date;
  /** Ordered, deduped list of question IDs the user actually saw. */
  questionsVisited: string[];
};

type SetAnswerValue = LooseAnswers[string];
type SetAnswerUpdater = (prev: SetAnswerValue) => SetAnswerValue;

export type UseFormStateApi = {
  state: FormState;
  /** Currently shown question, or null if visible is empty. */
  currentQuestion: Question | null;
  /**
   * Set or update an answer. Accepts either a value or a functional updater
   * that receives the previous value (use the function form to avoid stale
   * reads when multiple updates fire in the same tick — e.g. fast keyboard
   * toggling on multi_choice). Recomputes visibility either way.
   */
  setAnswer: (id: string, value: SetAnswerValue | SetAnswerUpdater) => void;
  /** Advance to the next visible question. */
  next: () => void;
  /** Pop history; otherwise step − 1. */
  back: () => void;
  /**
   * Direct jump (the review screen's edit links). `rewind` returns to a step
   * already passed as if by Back: history is cut back to it rather than the
   * current step pushed (a submit sending the respondent back, ADR-066).
   */
  goTo: (step: number, direction?: AnimDirection, rewind?: boolean) => void;
  /** Mark the current transition complete. */
  animationEnd: () => void;
  /** Per ADR-005 — answers payload for `onSubmit` (excludes hidden). */
  getSubmitAnswers: () => LooseAnswers;
  /**
   * Reset to step 0 with no answers, no history, fresh startedAt. Used by
   * the thanks-screen "Submit another" CTA.
   */
  restart: () => void;
  /** Replace answers/step/visited from a saved session (ADR-017). */
  hydrate: (snapshot: ResumeSnapshot) => void;
};

type RawState = {
  step: number;
  answers: LooseAnswers;
  history: string[];
  direction: AnimDirection;
  isAnimating: boolean;
  visitedIds: string[];
  /** Where the next advance returns to (ADR-069): Review, after an edit from it. */
  returnTo?: string;
};

/** Snapshot shape used by save-and-resume (ADR-017). */
export type ResumeSnapshot = {
  answers: LooseAnswers;
  step: number;
  visitedIds: string[];
  /** The fill's id (`SubmitMeta.fillId`, ADR-069); saves made before it have none. */
  fill?: string;
};

type Action =
  | { type: 'set_answer'; id: string; value: SetAnswerValue | SetAnswerUpdater }
  | { type: 'go_next' }
  | { type: 'go_back' }
  | { type: 'go_to'; step: number; direction: AnimDirection; rewind?: boolean }
  | { type: 'animation_end' }
  | { type: 'record_visited'; id: string }
  | { type: 'hydrate'; snapshot: ResumeSnapshot }
  | { type: 'reset' };

function makeReducer(allQuestions: ReadonlyArray<Question>, initial: RawState) {
  return function reducer(s: RawState, a: Action): RawState {
    switch (a.type) {
      case 'set_answer': {
        const prev = s.answers[a.id];
        const resolved = typeof a.value === 'function' ? a.value(prev) : a.value;
        const newAnswers = { ...s.answers, [a.id]: resolved };
        const oldVisible = visibleQuestions(allQuestions, s.answers);
        const newVisible = visibleQuestions(allQuestions, newAnswers);
        // Stay on the question shown, wherever the answer moved it in the list.
        const currentId = oldVisible[Math.min(s.step, Math.max(oldVisible.length - 1, 0))]?.id;
        const idx = newVisible.findIndex((q) => q.id === currentId);
        const step = idx >= 0 ? idx : Math.min(s.step, Math.max(newVisible.length - 1, 0));
        return { ...s, answers: newAnswers, step };
      }
      case 'go_next': {
        const visible = visibleQuestions(allQuestions, s.answers);
        const cur = Math.min(s.step, visible.length - 1);
        const current = visible[cur];
        if (!current) return s;
        // The respondent's path (ADR-069) is where an advance goes: logic
        // jumps (ADR-015), then any question a later answer revealed. Back
        // still works — the step left is pushed onto history like any other.
        const path = pathOf(
          visible,
          s.answers,
          otherIndex(allQuestions),
          areaIndex(allQuestions),
          initial.answers,
        );
        const at = path.indexOf(cur);
        // An edit from Review goes back to Review while the answers still lead
        // there — a jump past it wins — after any question the edit put on
        // the path that the respondent hasn't seen.
        const back = path.indexOf(visible.findIndex((q) => q.id === s.returnTo));
        const owed =
          at >= 0 && back > at
            ? path
                .slice(at + 1, back)
                .find((i) => !isChrome(visible[i]!) && !s.visitedIds.includes(visible[i]!.id))
            : undefined;
        // Off the path (Back after an edit moved it), on along it.
        const to =
          at < 0
            ? (path.find((i) => i > cur) ?? path[path.length - 1]!)
            : back > at
              ? (owed ?? path[back]!)
              : (path[at + 1] ?? path.next);
        if (to === s.step || !visible[to]) return s;
        return {
          ...s,
          history: [...s.history, current.id],
          step: to,
          direction: to > s.step ? 'forward' : 'backward',
          isAnimating: true,
          returnTo: owed === undefined ? undefined : s.returnTo,
        };
      }
      case 'go_back': {
        if (s.history.length === 0 && s.step === 0) return s;
        // Back to the step the respondent came from, if it's still shown; else the one before.
        const popped = s.history[s.history.length - 1];
        const idx = visibleQuestions(allQuestions, s.answers).findIndex((q) => q.id === popped);
        return {
          ...s,
          history: s.history.slice(0, -1),
          step: idx >= 0 ? idx : Math.max(s.step - 1, 0),
          direction: 'backward',
          isAnimating: true,
        };
      }
      case 'go_to': {
        const visible = visibleQuestions(allQuestions, s.answers);
        const target = Math.max(0, Math.min(a.step, visible.length - 1));
        if (target === s.step) return s;
        const current = visible[Math.min(s.step, visible.length - 1)];
        const cut = a.rewind ? s.history.lastIndexOf(visible[target]!.id) : -1;
        // An edit from Review comes back to it (ADR-069): returnTo.
        return {
          ...s,
          history: a.rewind
            ? cut >= 0
              ? s.history.slice(0, cut)
              : s.history
            : current
              ? [...s.history, current.id]
              : s.history,
          step: target,
          direction: a.direction,
          isAnimating: true,
          returnTo: !a.rewind && current?.type === 'review' ? current.id : s.returnTo,
        };
      }
      case 'animation_end':
        return s.isAnimating ? { ...s, isAnimating: false } : s;
      case 'hydrate': {
        const answers = a.snapshot.answers;
        const visible = visibleQuestions(allQuestions, answers);
        let step = Math.max(0, Math.min(a.snapshot.step, Math.max(visible.length - 1, 0)));
        // Never resume onto an ending: arriving there would send the answers again.
        if (visible[step]?.type === 'thanks' && step) step--;
        return {
          ...s,
          answers,
          step,
          visitedIds: a.snapshot.visitedIds,
          history: [],
          direction: 'forward',
          isAnimating: false,
          returnTo: undefined,
        };
      }
      case 'record_visited': {
        if (s.visitedIds.includes(a.id)) return s;
        return { ...s, visitedIds: [...s.visitedIds, a.id] };
      }
      case 'reset':
        return { ...initial };
    }
  };
}

const INITIAL_RAW: Omit<RawState, never> = {
  step: 0,
  answers: {},
  history: [],
  direction: 'forward',
  isAnimating: false,
  visitedIds: [],
};

export type UseFormStateOptions = {
  /**
   * Answers to start from — the link's prefill (ADR-063). Read on mount;
   * "Submit another" starts from them again.
   */
  initialAnswers?: LooseAnswers;
};

export function useFormState(schema: Schema, opts: UseFormStateOptions = {}): UseFormStateApi {
  const startedAtRef = useRef<Date>(new Date());
  const initialRef = useRef<RawState | null>(null);
  if (initialRef.current === null) {
    initialRef.current = { ...INITIAL_RAW, answers: { ...(opts.initialAnswers ?? {}) } };
  }
  const initial = initialRef.current;
  const reducer = useMemo(
    () => makeReducer(schema.questions, initial),
    [schema.questions, initial],
  );
  const [raw, dispatch] = useReducer(reducer, initial);

  const visible = useMemo(
    () => visibleQuestions(schema.questions, raw.answers),
    [schema.questions, raw.answers],
  );

  const safeStep = visible.length === 0 ? 0 : Math.min(raw.step, visible.length - 1);
  const currentQuestion = visible[safeStep] ?? null;

  // Record current question as visited.
  useEffect(() => {
    if (currentQuestion) dispatch({ type: 'record_visited', id: currentQuestion.id });
  }, [currentQuestion]);

  const setAnswer = useCallback((id: string, value: SetAnswerValue | SetAnswerUpdater) => {
    dispatch({ type: 'set_answer', id, value });
  }, []);

  const next = useCallback(() => dispatch({ type: 'go_next' }), []);
  const back = useCallback(() => dispatch({ type: 'go_back' }), []);

  const goTo = useCallback(
    (step: number, direction: AnimDirection = 'forward', rewind?: boolean) => {
      dispatch({ type: 'go_to', step, direction, rewind });
    },
    [],
  );

  const animationEnd = useCallback(() => dispatch({ type: 'animation_end' }), []);

  const restart = useCallback(() => {
    startedAtRef.current = new Date();
    dispatch({ type: 'reset' });
  }, []);

  const hydrate = useCallback((snapshot: ResumeSnapshot) => {
    dispatch({ type: 'hydrate', snapshot });
  }, []);

  // The respondent's path (ADR-069), with the same indexes and prefill as
  // navigation: what is sent, and what the Review step lists.
  const path = useMemo(
    () =>
      pathOf(
        visible,
        raw.answers,
        otherIndex(schema.questions),
        areaIndex(schema.questions),
        initial.answers,
      ).map((i) => visible[i]!),
    [visible, raw.answers, schema.questions, initial],
  );

  const getSubmitAnswers = useCallback(() => {
    const out: LooseAnswers = {};
    for (const q of path) {
      if (!isChrome(q) && raw.answers[q.id] !== undefined) out[q.id] = raw.answers[q.id];
    }
    return out;
  }, [path, raw.answers]);

  const state: FormState = {
    step: safeStep,
    visible,
    path,
    answers: raw.answers,
    history: raw.history,
    direction: raw.direction,
    isAnimating: raw.isAnimating,
    startedAt: startedAtRef.current,
    questionsVisited: raw.visitedIds,
  };

  return {
    state,
    currentQuestion,
    setAnswer,
    next,
    back,
    goTo,
    animationEnd,
    getSubmitAnswers,
    restart,
    hydrate,
  };
}
