/**
 * `<Form>` — the public entry component. Composes:
 *
 *   - useTheme        (resolves light/dark, drives the toggle)
 *   - useFormState    (step machine, answers, history, visited)
 *   - useKeyboardNav  (global Enter / A–Z / 0–9 / Esc)
 *   - chrome          (TopBar, ProgressBar, FooterCounter, ThemeToggle)
 *
 * Question rendering is dispatched by QuestionRenderer to per-type Field
 * components in src/components/questions/. New types only need an entry
 * there — this file doesn't change.
 *
 * onSubmit fires exactly once on entering the `thanks` step (per ADR-005).
 * A rejection carrying `goTo` returns to that question with its message
 * shown there and every answer kept (a sign-up slot that filled, ADR-066).
 *
 * Motion (ADR-059): the outgoing question gets its 220ms exit as an inert
 * copy laid over the stage (utils/questionHandoff.ts), and a confirmed
 * submit — not merely reaching thanks — fills the progress bar, completes
 * narrative decorations and plays the celebration + finale chord.
 */

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormProps, PartialMeta, Schema, SubmitMeta } from '@/types/Schema.js';
import { useFormState } from '@/hooks/useFormState.js';
import { useAutoAdvanceTimer } from '@/hooks/useAutoAdvanceTimer.js';
import { useAutosave } from '@/hooks/useAutosave.js';
import { useKeyboardNav } from '@/hooks/useKeyboardNav.js';
import { FormConfirmRefContext, FormOtherRefContext } from '@/hooks/useRegisterFormConfirm.js';
import { useTheme } from '@/hooks/useTheme.js';
import { useReducedMotion } from '@/hooks/useReducedMotion.js';
import { progress as progressFn } from '@/logic/progress.js';
import { computeScore } from '@/logic/scoring.js';
import { computeEstimate } from '@/logic/estimate.js';
import { prefillAnswers } from '@/logic/prefill.js';
import { allowsOther } from '@/logic/other.js';
import { TopBar } from './chrome/TopBar.js';
import { ProgressBar } from './chrome/ProgressBar.js';
import { FooterCounter } from './chrome/FooterCounter.js';
import { ThemeToggle } from './chrome/ThemeToggle.js';
import { QuestionRenderer } from './questions/QuestionRenderer.js';
import { preloadExtFields } from './questions/lazyFields.js';
import {
  ThemeDecoration,
  hasStepDecorationBackdrop,
  resolveThemeDecoration,
} from './ThemeDecoration.js';
import {
  playFormFinale,
  playFormSound,
  playTypewriterTick,
  resolveFormSound,
} from '@/utils/formSounds.js';
import { LEAVE_MAX_MS, snapshotLeavingQuestion } from '@/utils/questionHandoff.js';
import { migrateSlateLocalStorageKeys } from '@/utils/migrateLocalStorage.js';

import '@/styles/tokens.css';
import '@/styles/toggle.css';
import '@/styles/animations.css';
import '@/styles/base.css';
import '@/styles/questions.css';
import '@/styles/motion.css';

/** Absolute http(s) URL or null. Relative paths resolve against the page. */
function httpUrlOrNull(raw: string): string | null {
  try {
    const u = new URL(raw, window.location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function Form<S extends Schema>({
  schema,
  onSubmit,
  onQuestionChange,
  hiddenFields,
  prefill,
  errorMessage = 'Something went wrong submitting your form. Please try again.',
  onFileUpload,
  resolveFileUploadMeta,
  resume = false,
  onPartialChange,
  slotsLeft,
}: FormProps<S>) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const confirmStepRef = useRef<(() => void) | null>(null);
  const otherKeyRef = useRef<(() => void) | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    migrateSlateLocalStorageKeys();
  }, []);

  // On-demand field UIs this schema uses start downloading now, so they are
  // usually there before the respondent reaches them (ADR-063).
  useEffect(() => {
    preloadExtFields(schema.questions);
  }, [schema.questions]);

  // The link's prefill (ADR-063), read once on mount like the rest of the start state.
  const [initialAnswers] = useState(() => prefillAnswers(schema.questions, prefill));

  const {
    resolved: themeMode,
    toggleable,
    toggle,
  } = useTheme({
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
  } = useFormState(schema, { initialAnswers });

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
  /** A submit sent the respondent back to a question, with this message (ADR-066). */
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  // Running score (ADR-016) — feeds {{score}} piping and SubmitMeta.
  const score = useMemo(
    () => computeScore(schema.questions, state.answers),
    [schema.questions, state.answers],
  );

  // Instant estimate (ADR-064) — from the answers that will be submitted
  // (visible questions only), so what the respondent sees is what is sent.
  const estimate = useMemo(
    () => computeEstimate(schema, getSubmitAnswers()),
    [schema, getSubmitAnswers],
  );

  /* ---------- sound (ADR-023) — interaction-time, not step-change ---------- */

  const soundId = resolveFormSound(schema.sound);

  const playInteractionSound = useCallback(() => {
    if (soundId !== 'off') playFormSound(soundId);
  }, [soundId]);

  const playTypingSound = useCallback(() => {
    if (soundId !== 'off') playTypewriterTick();
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
      // The key after the last option is Other (ADR-063): the field owns its text box.
      if (
        (currentQuestion.type === 'single_choice' ||
          currentQuestion.type === 'multi_choice' ||
          currentQuestion.type === 'picture_choice') &&
        idx === currentQuestion.options.length &&
        allowsOther(currentQuestion)
      ) {
        otherKeyRef.current?.();
        return;
      }
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
          return cur.includes(opt.value) ? cur.filter((v) => v !== opt.value) : [...cur, opt.value];
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
      // A slider waits for OK (ADR-063); every other scale commits on the key.
      if (currentQuestion.type === 'scale' && currentQuestion.display === 'slider') return;
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
      ...(estimate ? { estimate } : {}),
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
        // Ending redirect (ADR-016) — only after a confirmed submit, and only
        // to http(s). A schema can arrive from an untrusted link, so never
        // hand `javascript:` or other schemes to the navigator.
        const safeRedirect = redirectUrl ? httpUrlOrNull(redirectUrl) : null;
        if (safeRedirect) window.location.assign(safeRedirect);
      })
      .catch((err: unknown) => {
        if (generation !== submitGenRef.current) return;
        const msg = err instanceof Error ? err.message : null;
        // Back to a question (a sign-up slot filled meanwhile): answers kept, submit re-armed.
        const back = (err as { goTo?: unknown } | null)?.goTo;
        const idx = state.visible.findIndex((q) => q.id === back);
        if (idx >= 0) {
          submittedRef.current = false;
          setSubmitStatus('idle');
          setNotice({ id: back as string, text: msg ?? errorMessage });
          goTo(idx, 'backward', true);
          return;
        }
        setSubmitStatus('error');
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
    estimate,
    resumeEnabled,
    clearAutosave,
    state.visible,
    goTo,
  ]);

  // The notice stays until the respondent moves on from its question.
  const noticeFor = notice && currentQuestion?.id === notice.id ? notice.text : null;
  const shownNoticeRef = useRef(false);
  useEffect(() => {
    if (noticeFor) shownNoticeRef.current = true;
    else if (notice && shownNoticeRef.current) {
      shownNoticeRef.current = false;
      setNotice(null);
    }
  }, [noticeFor, notice]);

  // Finale chord (ADR-059) — on a confirmed submit only, and only when the
  // form's sound is on. Keyed on the status flip so it plays once per submit.
  useEffect(() => {
    if (submitStatus === 'success' && soundId !== 'off') playFormFinale(soundId);
  }, [submitStatus, soundId]);

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
  // The bar only reaches 100% on a confirmed submit (ADR-059): while the
  // thanks step is still submitting — or has failed — it holds at the last
  // answered question's value.
  const onThanks = currentQuestion?.type === 'thanks';
  const submitConfirmed = onThanks && submitStatus === 'success';
  const rawProgress = progressFn(state.visible, state.step);
  const progressPct =
    onThanks && !submitConfirmed && counted > 0
      ? Math.min(rawProgress, ((counted - 1) / counted) * 100)
      : rawProgress;

  /* ---------- question hand-off (brief §10.2 outgoing 220ms) ---------- */

  const stageRef = useRef<HTMLDivElement>(null);
  const leaveHostRef = useRef<HTMLDivElement>(null);
  const liveContentRef = useRef<HTMLDivElement | null>(null);
  const pendingLeaveRef = useRef<HTMLElement | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  // React calls this with null just before it removes the old question from
  // the DOM (the key changed), which is the last moment we can copy it.
  const stageContentRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      liveContentRef.current = node;
      return;
    }
    const old = liveContentRef.current;
    liveContentRef.current = null;
    pendingLeaveRef.current =
      old && !reducedMotionRef.current ? snapshotLeavingQuestion(old, stageRef.current) : null;
  }, []);

  const questionKey = currentQuestion?.id ?? 'empty';
  useLayoutEffect(() => {
    const leaving = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    const host = leaveHostRef.current;
    if (!leaving || !host) return undefined;
    leaving.dataset.direction = state.direction;
    host.replaceChildren(leaving);
    const finish = () => leaving.remove();
    const onEnd = (e: AnimationEvent) => {
      if (e.target === leaving) finish();
    };
    leaving.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(finish, LEAVE_MAX_MS);
    return () => {
      window.clearTimeout(timer);
      leaving.removeEventListener('animationend', onEnd);
      finish();
    };
    // Keyed on the question only; direction is read at swap time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey]);

  const decoration = resolveThemeDecoration(schema.theme);

  return (
    <div
      ref={wrapperRef}
      data-slate-forms=""
      data-theme-name={schema.theme}
      data-theme={themeMode}
      {...(hasStepDecorationBackdrop(decoration) ? { 'data-has-decoration': '' } : {})}
      {...(reducedMotion ? { 'data-reduced-motion': '' } : {})}
    >
      <ThemeDecoration themeName={schema.theme} step={state.step} complete={submitConfirmed} />

      <ProgressBar value={progressPct} complete={submitConfirmed} />

      <TopBar
        brandName={schema.brand.name}
        brandLogo={schema.brand.logo}
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
            <button type="button" className="slate-resume-btn" onClick={autosave.discardSaved}>
              Start over
            </button>
          </div>
        </div>
      )}

      <div className="slate-stage" ref={stageRef}>
        {/* Outgoing question copies land here (never React-managed children). */}
        <div className="slate-q-leave-host" ref={leaveHostRef} aria-hidden="true" />
        <FormConfirmRefContext.Provider value={confirmStepRef}>
          <FormOtherRefContext.Provider value={otherKeyRef}>
            <div
              key={questionKey}
              ref={stageContentRef}
              className="slate-q-enter slate-stage-content"
              data-direction={state.direction}
              onAnimationEnd={animationEnd}
            >
              {noticeFor ? (
                <p className="slate-notice" role="alert">
                  {noticeFor}
                </p>
              ) : null}
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
                  playTypingSound={playTypingSound}
                  allQuestions={schema.questions}
                  estimate={estimate}
                  estimateSettings={schema.estimate}
                  slotsLeft={slotsLeft?.[currentQuestion.id]}
                />
              ) : null}
            </div>
          </FormOtherRefContext.Provider>
        </FormConfirmRefContext.Provider>
      </div>

      {isAnswerBearing && counted > 0 && <FooterCounter current={stepNumber} total={counted} />}
    </div>
  );
}
