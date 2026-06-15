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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormProps, PartialMeta, Schema, SubmitMeta } from '@/types/Schema.js';
import { useFormState } from '@/hooks/useFormState.js';
import { useAutoAdvanceTimer } from '@/hooks/useAutoAdvanceTimer.js';
import { useAutosave } from '@/hooks/useAutosave.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import { FormConfirmRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { useTheme } from '@/hooks/useTheme.js';
import { progress as progressFn } from '@/logic/progress.js';
import { computeScore } from '@/logic/scoring.js';
import { TopBar } from './chrome/TopBar.js';
import { ProgressBar } from './chrome/ProgressBar.js';
import { FooterCounter } from './chrome/FooterCounter.js';
import { ThemeToggle } from './chrome/ThemeToggle.js';
import { QuestionRenderer } from './questions/QuestionRenderer.js';
import {
  ThemeDecoration,
  hasStepDecorationBackdrop,
  resolveThemeDecoration,
} from './ThemeDecoration.js';
import { playFormSound, resolveFormSound } from '@/utils/formSounds.js';
import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';

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
  onFileUpload,
  resolveFileUploadMeta,
  resume = false,
  onPartialChange,
}: FormProps<S>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const confirmStepRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    migrateSlateLocalStorageKeys();
  }, []);

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
    goTo,
    getSubmitAnswers,
    animationEnd,
    restart,
    hydrate,
  } = useFormState(schema);

  const { schedule: scheduleAutoAdvance, clear: clearAutoAdvance } = useAutoAdvanceTimer(
    currentQuestion?.id,
  );

  /* ---------- save-and-resume (ADR-017) ---------- */

  const resumeEnabled = Boolean(resume && schema.id);
  const autosave = useAutosave({
    enabled: resumeEnabled,
    formId: schema.id ?? '',
    answers: state.answers,
    step: state.step,
    visitedIds: state.questionsVisited,
  });
  const clearAutosave = autosave.clear;

  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>(
    'idle',
  );
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);

  // Running score (ADR-016) — feeds {{score}} piping and SubmitMeta.
  const score = useMemo(
    () => computeScore(schema.questions, state.answers),
    [schema.questions, state.answers],
  );

  /* ---------- sound (ADR-023) — interaction-time, not step-change ---------- */

  const soundId = resolveFormSound(schema.sound);

  const playInteractionSound = useCallback(() => {
    if (soundId !== 'off') playFormSound(soundId);
  }, [soundId]);

  const advanceWithSound = useCallback(() => {
    playInteractionSound();
    next();
  }, [playInteractionSound, next]);

  const backWithClear = useCallback(() => {
    clearAutoAdvance();
    back();
  }, [clearAutoAdvance, back]);

  /* ---------- keyboard handlers ---------- */

  const onSelectChoice = useCallback(
    (idx: number) => {
      if (!currentQuestion) return;
      if (currentQuestion.type === 'single_choice') {
        const opt = currentQuestion.options[idx];
        if (!opt) return;
        playInteractionSound();
        setAnswer(currentQuestion.id, opt.value);
        // Auto-advance per brief §5.
        scheduleAutoAdvance(() => next());
      } else if (currentQuestion.type === 'picture_choice') {
        const opt = currentQuestion.options[idx];
        if (!opt) return;
        playInteractionSound();
        if (currentQuestion.multiple) {
          setAnswer(currentQuestion.id, (prev) => {
            const cur = Array.isArray(prev) ? (prev as string[]) : [];
            return cur.includes(opt.value)
              ? cur.filter((v) => v !== opt.value)
              : [...cur, opt.value];
          });
        } else {
          setAnswer(currentQuestion.id, opt.value);
          scheduleAutoAdvance(() => next());
        }
      } else if (currentQuestion.type === 'yes_no') {
        playInteractionSound();
        setAnswer(currentQuestion.id, idx === 0 ? 'yes' : 'no');
        scheduleAutoAdvance(() => next());
      } else if (currentQuestion.type === 'legal') {
        playInteractionSound();
        setAnswer(currentQuestion.id, idx === 0 ? 'accept' : 'decline');
        scheduleAutoAdvance(() => next());
      } else if (currentQuestion.type === 'multi_choice') {
        const opt = currentQuestion.options[idx];
        if (!opt) return;
        playInteractionSound();
        // Functional updater so back-to-back keypresses don't see stale state.
        setAnswer(currentQuestion.id, (prev) => {
          const cur = Array.isArray(prev) ? (prev as string[]) : [];
          return cur.includes(opt.value)
            ? cur.filter((v) => v !== opt.value)
            : [...cur, opt.value];
        });
      }
    },
    [currentQuestion, setAnswer, next, playInteractionSound, scheduleAutoAdvance],
  );

  const onSelectScale = useCallback(
    (value: number) => {
      if (!currentQuestion) return;
      if (currentQuestion.type !== 'scale' && currentQuestion.type !== 'nps') return;
      playInteractionSound();
      setAnswer(currentQuestion.id, value);
      scheduleAutoAdvance(() => next());
    },
    [currentQuestion, setAnswer, next, playInteractionSound, scheduleAutoAdvance],
  );

  useKeyboardNav({
    currentQ: currentQuestion,
    onAdvance: advanceWithSound,
    onBack: backWithClear,
    onConfirm: () => {
      if (!confirmStepRef.current) return false;
      confirmStepRef.current();
      return true;
    },
    onSelectChoice,
    onSelectScale,
  });

  /* ---------- onQuestionChange ---------- */

  useEffect(() => {
    if (!currentQuestion || !onQuestionChange) return;
    onQuestionChange(currentQuestion.id, getSubmitAnswers() as never);
  }, [currentQuestion, onQuestionChange, getSubmitAnswers]);

  /* ---------- onPartialChange (abandonment capture) ---------- */

  useEffect(() => {
    if (!onPartialChange || !currentQuestion) return;
    if (Object.keys(state.answers).length === 0) return;
    if (currentQuestion.type === 'thanks') return;
    const meta: PartialMeta = {
      startedAt: state.startedAt,
      lastQuestionId: currentQuestion.id,
      questionsVisited: state.questionsVisited,
      hiddenFields: hiddenFields ?? {},
      score,
    };
    onPartialChange(getSubmitAnswers() as never, meta);
    // Intentionally keyed on answers only — fires per answer change, not per
    // navigation step (onQuestionChange covers that).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.answers]);

  /* ---------- onSubmit (fires exactly once on entering thanks) ---------- */

  const submittedRef = useRef(false);
  const submitGenRef = useRef(0);

  // `submitStatus` is a dependency so that retrySubmit (which resets the
  // ref and flips status back to 'idle') re-triggers this effect — without
  // it the Retry button never re-fires onSubmit.
  useEffect(() => {
    if (currentQuestion?.type !== 'thanks' || submittedRef.current) return;
    submittedRef.current = true;
    const generation = ++submitGenRef.current;

    const meta: SubmitMeta = {
      startedAt: state.startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - state.startedAt.getTime(),
      questionsVisited: state.questionsVisited,
      hiddenFields: hiddenFields ?? {},
      score,
    };

    const redirectUrl = currentQuestion.redirectUrl;

    setSubmitStatus('submitting');
    setSubmitErrorMsg(null);

    // Note: we intentionally do NOT use a cancelled-flag cleanup here. The
    // submittedRef guard already ensures onSubmit fires exactly once across
    // any remount, including StrictMode's intentional double-invocation.
    // Adding a cleanup that sets cancelled=true would silently swallow the
    // success state on the second mount.
    Promise.resolve(onSubmit(getSubmitAnswers() as never, meta))
      .then(() => {
        if (generation !== submitGenRef.current) return;
        setSubmitStatus('success');
        // Completed — drop the save-and-resume snapshot (ADR-017).
        if (resumeEnabled) clearAutosave();
        // Ending redirect (ADR-016) — only after a confirmed submit.
        if (redirectUrl) window.location.assign(redirectUrl);
      })
      .catch((err: unknown) => {
        if (generation !== submitGenRef.current) return;
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
    score,
    resumeEnabled,
    clearAutosave,
  ]);

  const retrySubmit = useCallback(() => {
    submittedRef.current = false;
    submitGenRef.current += 1;
    setSubmitStatus('idle');
    setSubmitErrorMsg(null);
  }, []);

  const restartForm = useCallback(() => {
    clearAutoAdvance();
    submittedRef.current = false;
    submitGenRef.current += 1;
    setSubmitStatus('idle');
    setSubmitErrorMsg(null);
    restart();
  }, [clearAutoAdvance, restart]);

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

  const decoration = resolveThemeDecoration(schema.theme);

  return (
    <div
      ref={wrapperRef}
      data-slate-forms=""
      data-theme-name={schema.theme}
      data-theme={themeMode}
      {...(hasStepDecorationBackdrop(decoration) ? { 'data-has-decoration': '' } : {})}
    >
      <ThemeDecoration themeName={schema.theme} step={state.step} />

      <ProgressBar value={progressPct} />

      <TopBar
        brandName={schema.brand.name}
        showBack={showBack}
        onBack={backWithClear}
        rightSlot={
          toggleable ? <ThemeToggle mode={themeMode} onToggle={toggle} ref={toggleRef} /> : null
        }
      />

      {autosave.savedSession && (
        <div className="slate-resume-banner" role="dialog" aria-label="Resume saved progress">
          <span className="slate-resume-text">Pick up where you left off?</span>
          <div className="slate-resume-actions">
            <button
              type="button"
              className="slate-resume-btn slate-resume-btn--primary"
              onClick={() => {
                const snapshot = autosave.acceptSaved();
                if (snapshot) hydrate(snapshot);
              }}
            >
              Resume
            </button>
            <button
              type="button"
              className="slate-resume-btn"
              onClick={autosave.discardSaved}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      <div className="slate-stage">
        <FormConfirmRefContext.Provider value={confirmStepRef}>
          <div
            key={currentQuestion?.id ?? 'empty'}
            className="slate-q-enter slate-stage-content"
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
                onFileUpload={onFileUpload}
                resolveFileUploadMeta={resolveFileUploadMeta}
                score={score}
                visibleList={state.visible}
                onEditQuestion={(id) => {
                  const idx = state.visible.findIndex((q) => q.id === id);
                  if (idx >= 0) goTo(idx, 'backward');
                }}
                playInteractionSound={playInteractionSound}
              />
            ) : null}
          </div>
        </FormConfirmRefContext.Provider>
      </div>

      {isAnswerBearing && counted > 0 && (
        <FooterCounter current={stepNumber} total={counted} />
      )}
    </div>
  );
}

