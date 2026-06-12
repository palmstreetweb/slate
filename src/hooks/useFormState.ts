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
import { resolveJumpTarget, visibleAnswersForSubmit, visibleQuestions } from '@/logic/progress.js';

export type AnimDirection = 'forward' | 'backward';

export type FormState = {
  /** Current index into the visible-questions list. */
  step: number;
  /** The visible-questions list (chrome screens included). */
  visible: Question[];
  /** All answers, including those for now-hidden questions (per ADR-005). */
  answers: LooseAnswers;
  /** Stack of step indices for back navigation. */
  history: number[];
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
  /** Direct jump (rare — used for restart from thanks). */
  goTo: (step: number, direction?: AnimDirection) => void;
  /** Mark the current transition complete. */
  animationEnd: () => void;
  /** Per ADR-005 — answers payload for `onSubmit` (excludes hidden). */
  getSubmitAnswers: () => LooseAnswers;
  /**
   * Reset to step 0 with no answers, no history, fresh startedAt. Used by
   * the thanks-screen "Submit another" CTA.
   */
  restart: () => void;
};

type RawState = {
  step: number;
  answers: LooseAnswers;
  history: number[];
  direction: AnimDirection;
  isAnimating: boolean;
  visitedIds: string[];
};

type Action =
  | { type: 'set_answer'; id: string; value: SetAnswerValue | SetAnswerUpdater }
  | { type: 'go_next' }
  | { type: 'go_back' }
  | { type: 'go_to'; step: number; direction: AnimDirection }
  | { type: 'animation_end' }
  | { type: 'record_visited'; id: string }
  | { type: 'reset' };

function makeReducer(allQuestions: ReadonlyArray<Question>) {
  return function reducer(s: RawState, a: Action): RawState {
    switch (a.type) {
      case 'set_answer': {
        const prev = s.answers[a.id];
        const resolved = typeof a.value === 'function' ? a.value(prev) : a.value;
        const newAnswers = { ...s.answers, [a.id]: resolved };
        const newVisible = visibleQuestions(allQuestions, newAnswers);
        const clampedStep = Math.min(s.step, Math.max(newVisible.length - 1, 0));
        return { ...s, answers: newAnswers, step: clampedStep };
      }
      case 'go_next': {
        const visible = visibleQuestions(allQuestions, s.answers);
        const current = visible[Math.min(s.step, visible.length - 1)];
        // Logic jumps (ADR-015): first matching rule on the current question
        // overrides the default step+1. Back-nav still works — the jump
        // origin is pushed onto history like any other advance.
        const jump = current ? resolveJumpTarget(current, visible, s.answers) : null;
        const next = jump !== null && jump !== s.step
          ? jump
          : Math.min(s.step + 1, visible.length - 1);
        if (next === s.step) return s;
        return {
          ...s,
          history: [...s.history, s.step],
          step: next,
          direction: next > s.step ? 'forward' : 'backward',
          isAnimating: true,
        };
      }
      case 'go_back': {
        if (s.history.length === 0 && s.step === 0) return s;
        const popped = s.history.length > 0 ? s.history[s.history.length - 1] : undefined;
        const target = popped ?? Math.max(s.step - 1, 0);
        return {
          ...s,
          history: s.history.slice(0, -1),
          step: target,
          direction: 'backward',
          isAnimating: true,
        };
      }
      case 'go_to': {
        const visible = visibleQuestions(allQuestions, s.answers);
        const target = Math.max(0, Math.min(a.step, visible.length - 1));
        if (target === s.step) return s;
        return {
          ...s,
          step: target,
          direction: a.direction,
          isAnimating: true,
        };
      }
      case 'animation_end':
        return s.isAnimating ? { ...s, isAnimating: false } : s;
      case 'record_visited': {
        if (s.visitedIds.includes(a.id)) return s;
        return { ...s, visitedIds: [...s.visitedIds, a.id] };
      }
      case 'reset':
        return { ...INITIAL_RAW };
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

export function useFormState(schema: Schema): UseFormStateApi {
  const startedAtRef = useRef<Date>(new Date());
  const reducer = useMemo(() => makeReducer(schema.questions), [schema.questions]);
  const [raw, dispatch] = useReducer(reducer, INITIAL_RAW);

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

  const setAnswer = useCallback(
    (id: string, value: SetAnswerValue | SetAnswerUpdater) => {
      dispatch({ type: 'set_answer', id, value });
    },
    [],
  );

  const next = useCallback(() => dispatch({ type: 'go_next' }), []);
  const back = useCallback(() => dispatch({ type: 'go_back' }), []);

  const goTo = useCallback((step: number, direction: AnimDirection = 'forward') => {
    dispatch({ type: 'go_to', step, direction });
  }, []);

  const animationEnd = useCallback(() => dispatch({ type: 'animation_end' }), []);

  const restart = useCallback(() => {
    startedAtRef.current = new Date();
    dispatch({ type: 'reset' });
  }, []);

  const getSubmitAnswers = useCallback(
    () => visibleAnswersForSubmit(visible, raw.answers),
    [visible, raw.answers],
  );

  const state: FormState = {
    step: safeStep,
    visible,
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
  };
}
