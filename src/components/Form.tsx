/**
 * `<Form>` — the public entry component. Composes:
 *
 *   - useTheme        (resolves light/dark, drives the toggle)
 *   - useFormState    (step machine, answers, history, visited)
 *   - useKeyboardNav  (global Enter / A–F / 0–9 / Esc)
 *   - chrome          (TopBar, ProgressBar, FooterCounter, ThemeToggle)
 *
 * Question rendering itself is delegated to `QuestionRenderer`, which is a
 * placeholder shim in STEP 5 — STEP 6 swaps in the real per-type Field
 * components without changing this file.
 *
 * onSubmit fires exactly once on entering the `thanks` step (per ADR-005).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import type { FormProps, Schema, SubmitMeta } from '@/types/Schema.js';
import { useFormState } from '@/hooks/useFormState.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import { useTheme } from '@/hooks/useTheme.js';
import { progress as progressFn } from '@/logic/progress.js';
import { TopBar } from './chrome/TopBar.js';
import { ProgressBar } from './chrome/ProgressBar.js';
import { FooterCounter } from './chrome/FooterCounter.js';
import { ThemeToggle } from './chrome/ThemeToggle.js';
import { QuestionRenderer } from './questions/QuestionRenderer.js';

import '@/styles/tokens.css';
import '@/styles/toggle.css';
import '@/styles/animations.css';
import '@/styles/base.css';

export function Form<S extends Schema>({
  schema,
  onSubmit,
  onQuestionChange,
  hiddenFields,
  errorMessage = 'Something went wrong submitting your form. Please try again.',
}: FormProps<S>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const { resolved: themeMode, toggleable, toggle } = useTheme({
    mode: schema.themeMode,
    wrapperRef,
    toggleRef,
  });

  const {
    state,
    currentQuestion,
    setAnswer,
    next,
    back,
    getSubmitAnswers,
    animationEnd,
  } = useFormState(schema);

  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>(
    'idle',
  );
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);

  /* ---------- keyboard handlers ---------- */

  const onSelectChoice = useCallback(
    (idx: number) => {
      if (!currentQuestion) return;
      if (currentQuestion.type === 'single_choice') {
        const opt = currentQuestion.options[idx];
        if (!opt) return;
        setAnswer(currentQuestion.id, opt.value);
        // Auto-advance per brief §5.
        window.setTimeout(() => next(), 220);
      } else if (currentQuestion.type === 'multi_choice') {
        const opt = currentQuestion.options[idx];
        if (!opt) return;
        const cur = (state.answers[currentQuestion.id] as string[] | undefined) ?? [];
        const newSet = cur.includes(opt.value)
          ? cur.filter((v) => v !== opt.value)
          : [...cur, opt.value];
        setAnswer(currentQuestion.id, newSet);
      }
    },
    [currentQuestion, setAnswer, next, state.answers],
  );

  const onSelectScale = useCallback(
    (value: number) => {
      if (!currentQuestion || currentQuestion.type !== 'scale') return;
      setAnswer(currentQuestion.id, value);
      window.setTimeout(() => next(), 220);
    },
    [currentQuestion, setAnswer, next],
  );

  useKeyboardNav({
    currentQ: currentQuestion,
    onAdvance: next,
    onBack: back,
    onSelectChoice,
    onSelectScale,
  });

  /* ---------- onQuestionChange ---------- */

  useEffect(() => {
    if (!currentQuestion || !onQuestionChange) return;
    onQuestionChange(currentQuestion.id, getSubmitAnswers() as never);
  }, [currentQuestion, onQuestionChange, getSubmitAnswers]);

  /* ---------- onSubmit (fires exactly once on entering thanks) ---------- */

  const submittedRef = useRef(false);

  useEffect(() => {
    if (currentQuestion?.type !== 'thanks' || submittedRef.current) return;
    submittedRef.current = true;

    const meta: SubmitMeta = {
      startedAt: state.startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - state.startedAt.getTime(),
      questionsVisited: state.questionsVisited,
      hiddenFields: hiddenFields ?? {},
    };

    setSubmitStatus('submitting');
    setSubmitErrorMsg(null);

    let cancelled = false;
    Promise.resolve(onSubmit(getSubmitAnswers() as never, meta))
      .then(() => {
        if (cancelled) return;
        setSubmitStatus('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSubmitStatus('error');
        const msg = err instanceof Error ? err.message : null;
        setSubmitErrorMsg(msg ?? errorMessage);
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentQuestion,
    onSubmit,
    state.startedAt,
    state.questionsVisited,
    hiddenFields,
    getSubmitAnswers,
    errorMessage,
  ]);

  const retrySubmit = useCallback(() => {
    submittedRef.current = false;
    setSubmitStatus('idle');
    setSubmitErrorMsg(null);
  }, []);

  /* ---------- derived UI counts ---------- */

  const counted = state.visible.filter(
    (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
  ).length;
  const passedCounted = state.visible
    .slice(0, state.step)
    .filter((q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement').length;
  const isAnswerBearing =
    currentQuestion?.type !== 'welcome' &&
    currentQuestion?.type !== 'thanks' &&
    currentQuestion?.type !== 'statement';
  const stepNumber = isAnswerBearing ? passedCounted + 1 : 0;

  const showBack = state.step > 0 && currentQuestion?.type !== 'thanks';
  const progressPct = progressFn(state.visible, state.step);

  return (
    <div
      ref={wrapperRef}
      data-psw-forms=""
      data-theme-name={schema.theme}
      data-theme={themeMode}
    >
      <ProgressBar value={progressPct} />

      <TopBar
        brandName={schema.brand.name}
        showBack={showBack}
        onBack={back}
        rightSlot={
          toggleable ? <ThemeToggle mode={themeMode} onToggle={toggle} ref={toggleRef} /> : null
        }
      />

      <div className="psw-stage">
        <div
          key={currentQuestion?.id ?? 'empty'}
          className="psw-q-enter psw-stage-content"
          data-direction={state.direction}
          onAnimationEnd={animationEnd}
        >
          {currentQuestion ? (
            <QuestionRenderer
              question={currentQuestion}
              answers={state.answers}
              setAnswer={setAnswer}
              advance={next}
              stepNumber={stepNumber}
              totalSteps={counted}
              submitStatus={currentQuestion.type === 'thanks' ? submitStatus : 'idle'}
              submitError={submitErrorMsg}
              onRetrySubmit={retrySubmit}
            />
          ) : null}
        </div>
      </div>

      {isAnswerBearing && counted > 0 && (
        <FooterCounter current={stepNumber} total={counted} />
      )}
    </div>
  );
}

/* Re-export the placeholder API surface so STEP 6 can adopt it without
   changing this file. */
export type QuestionRendererProps = {
  question: Question;
  answers: LooseAnswers;
  setAnswer: (id: string, value: LooseAnswers[string]) => void;
  advance: () => void;
  stepNumber: number;
  totalSteps: number;
  submitStatus: 'idle' | 'submitting' | 'success' | 'error';
  submitError: string | null;
  onRetrySubmit: () => void;
};
