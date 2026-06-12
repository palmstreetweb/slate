/**
 * `<Form>` — the public entry component. Composes:
 *
 *   - useTheme        (resolves light/dark, drives the toggle)
 *   - useFormState    (step machine, answers, history, visited)
 *   - useKeyboardNav  (global Enter / A–F / 0–9 / Esc)
 *   - chrome          (TopBar, ProgressBar, FooterCounter, ThemeToggle)
 *
 * Question rendering is dispatched by QuestionRenderer to per-type Field
 * components in src/components/questions/. New types only need an entry
 * there — this file doesn't change.
 *
 * onSubmit fires exactly once on entering the `thanks` step (per ADR-005).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormProps, Schema, SubmitMeta } from '@/types/Schema.js';
import { useFormState } from '@/hooks/useFormState.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import { useTheme } from '@/hooks/useTheme.js';
import { progress as progressFn } from '@/logic/progress.js';
import { themes } from '@/themes/index.js';
import type { Theme } from '@/types/Theme.js';
import { TopBar } from './chrome/TopBar.js';
import { ProgressBar } from './chrome/ProgressBar.js';
import { FooterCounter } from './chrome/FooterCounter.js';
import { ThemeToggle } from './chrome/ThemeToggle.js';
import { QuestionRenderer } from './questions/QuestionRenderer.js';
import { SwissDecoration } from './decorations/SwissDecoration.js';
import { GrainDecoration } from './decorations/GrainDecoration.js';

import '@/styles/tokens.css';
import '@/styles/toggle.css';
import '@/styles/animations.css';
import '@/styles/base.css';
import '@/styles/questions.css';

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
    restart,
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
      } else if (currentQuestion.type === 'yes_no') {
        setAnswer(currentQuestion.id, idx === 0 ? 'yes' : 'no');
        window.setTimeout(() => next(), 220);
      } else if (currentQuestion.type === 'legal') {
        setAnswer(currentQuestion.id, idx === 0 ? 'accept' : 'decline');
        window.setTimeout(() => next(), 220);
      } else if (currentQuestion.type === 'multi_choice') {
        const opt = currentQuestion.options[idx];
        if (!opt) return;
        // Functional updater so back-to-back keypresses don't see stale state.
        setAnswer(currentQuestion.id, (prev) => {
          const cur = Array.isArray(prev) ? (prev as string[]) : [];
          return cur.includes(opt.value)
            ? cur.filter((v) => v !== opt.value)
            : [...cur, opt.value];
        });
      }
    },
    [currentQuestion, setAnswer, next],
  );

  const onSelectScale = useCallback(
    (value: number) => {
      if (!currentQuestion) return;
      if (currentQuestion.type !== 'scale' && currentQuestion.type !== 'nps') return;
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

  // `submitStatus` is a dependency so that retrySubmit (which resets the
  // ref and flips status back to 'idle') re-triggers this effect — without
  // it the Retry button never re-fires onSubmit.
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

    // Note: we intentionally do NOT use a cancelled-flag cleanup here. The
    // submittedRef guard already ensures onSubmit fires exactly once across
    // any remount, including StrictMode's intentional double-invocation.
    // Adding a cleanup that sets cancelled=true would silently swallow the
    // success state on the second mount.
    Promise.resolve(onSubmit(getSubmitAnswers() as never, meta))
      .then(() => setSubmitStatus('success'))
      .catch((err: unknown) => {
        setSubmitStatus('error');
        const msg = err instanceof Error ? err.message : null;
        setSubmitErrorMsg(msg ?? errorMessage);
      });
  }, [
    currentQuestion,
    onSubmit,
    state.startedAt,
    state.questionsVisited,
    hiddenFields,
    getSubmitAnswers,
    errorMessage,
    submitStatus,
  ]);

  const retrySubmit = useCallback(() => {
    submittedRef.current = false;
    setSubmitStatus('idle');
    setSubmitErrorMsg(null);
  }, []);

  const restartForm = useCallback(() => {
    submittedRef.current = false;
    setSubmitStatus('idle');
    setSubmitErrorMsg(null);
    restart();
  }, [restart]);

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

  // Decoration hint from the theme registry; custom theme names fall back
  // to no decoration.
  const decoration =
    (themes as Record<string, Theme | undefined>)[schema.theme]?.decoration ?? 'none';

  return (
    <div
      ref={wrapperRef}
      data-psw-forms=""
      data-theme-name={schema.theme}
      data-theme={themeMode}
    >
      {decoration === 'shapes' && <SwissDecoration step={state.step} />}
      {decoration === 'grain' && <GrainDecoration />}

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
              onRestart={restartForm}
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

