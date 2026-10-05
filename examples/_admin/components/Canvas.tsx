/**
 * Center canvas — renders the currently-selected question exactly as a
 * respondent would see it. We bypass the full <Form> engine (no advance,
 * no submit, no navigation) but mount the same theme backdrop, chrome, and
 * QuestionRenderer inside a mock data-slate-forms wrapper.
 *
 * Mode is resolved from schema.themeMode, with a small Light/Dark
 * override pill so designers can preview both modes quickly when the
 * schema's themeMode is 'toggle' or 'auto'.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Question, Schema, ThemeMode, ResolvedThemeMode } from '@/index.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { listSubmissions, subscribe as subscribeSubmissions } from '../_submissionStore.js';
import { localSlotsLeft } from '../signupSlots.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';
import { TopBar } from '@/components/chrome/TopBar.js';
import { ProgressBar } from '@/components/chrome/ProgressBar.js';
import { FooterCounter } from '@/components/chrome/FooterCounter.js';
import {
  ThemeDecoration,
  hasStepDecorationBackdrop,
  resolveThemeDecoration,
} from '@/components/ThemeDecoration.js';
import { progress as progressFn, visibleQuestions } from '@/logic/progress.js';
import { hostFileUpload } from '../hostFileUpload.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import { clearUploadContext, setUploadContext } from '../uploadContext.js';
import { TYPE_LABEL } from '../questionTypeMeta.js';
import { sampleEstimate } from '../estimatePreview.js';
import { usePreviewFocusGuard } from './usePreviewFocusGuard.js';

import '@/styles/tokens.css';
import '@/styles/toggle.css';
import '@/styles/animations.css';
import '@/styles/base.css';
import '@/styles/questions.css';

type Props = {
  formId: string;
  schema: Schema;
  selectedQuestion: Question;
};

function defaultMode(themeMode: ThemeMode): ResolvedThemeMode {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
}

export function Canvas({ formId, schema, selectedQuestion }: Props) {
  const forced = schema.themeMode === 'light' || schema.themeMode === 'dark';
  // Sign-up slots preview with the spots people have taken so far (ADR-066).
  const [subsTick, setSubsTick] = useState(0);
  useEffect(() => subscribeSubmissions(() => setSubsTick((n) => n + 1)), []);
  const slotsLeft = useMemo(
    () =>
      selectedQuestion.type === 'signup_slots'
        ? localSlotsLeft([selectedQuestion], listSubmissions(formId))[selectedQuestion.id]
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recount when responses change
    [selectedQuestion, formId, subsTick],
  );
  const [mode, setMode] = useState<ResolvedThemeMode>(() => defaultMode(schema.themeMode));

  // The preview is clickable: picks stick while one question is shown, so an
  // owner trying a multi choice sees their ticks instead of "Pick at least 2"
  // over an empty list. Nothing is saved; a new selection starts fresh.
  const [answers, setAnswers] = useState<LooseAnswers>({});
  const [tryKey, setTryKey] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const setAnswer = useCallback(
    (id: string, value: LooseAnswers[string] | ((prev: LooseAnswers[string]) => LooseAnswers[string])) =>
      setAnswers((prev) => ({
        ...prev,
        [id]: typeof value === 'function' ? value(prev[id]) : value,
      })),
    [],
  );
  // A finished try (OK, a swiped card) resets the question so it can be tried again.
  const restartTry = useCallback(() => {
    setAnswers({});
    setTryKey((n) => n + 1);
  }, []);

  // Each selected question opens at its top with nothing picked.
  useLayoutEffect(() => {
    setAnswers({});
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [selectedQuestion.id]);

  useEffect(() => {
    setUploadContext(formId);
    return () => clearUploadContext();
  }, [formId]);

  // Re-resolve when the schema's themeMode setting changes (e.g. user
  // toggled "Force dark" in the outline settings).
  useEffect(() => {
    setMode(defaultMode(schema.themeMode));
  }, [schema.themeMode]);

  const visible = useMemo(() => visibleQuestions(schema.questions, {}), [schema.questions]);

  const stepIndex = useMemo(() => {
    const idx = visible.findIndex((q) => q.id === selectedQuestion.id);
    return idx >= 0 ? idx : 0;
  }, [visible, selectedQuestion.id]);

  // An ending that shows the estimate previews it with sample answers (ADR-064).
  const previewEstimate = useMemo(
    () => (selectedQuestion.type === 'thanks' ? sampleEstimate(schema) : null),
    [schema, selectedQuestion.type],
  );

  const decoration = resolveThemeDecoration(schema.theme);
  const progressPct = progressFn(visible, stepIndex);

  // Step number for the badge — count answer-bearing questions up to the
  // selected one so the user sees an accurate "02 →" preview.
  const stepNumber = useMemo(() => {
    if (
      selectedQuestion.type === 'welcome' ||
      selectedQuestion.type === 'thanks' ||
      selectedQuestion.type === 'statement'
    ) {
      return 0;
    }
    let count = 0;
    for (const q of schema.questions) {
      if (q.type === 'welcome' || q.type === 'thanks' || q.type === 'statement') continue;
      count += 1;
      if (q.id === selectedQuestion.id) return count;
    }
    return count;
  }, [schema.questions, selectedQuestion]);

  const totalSteps = useMemo(
    () =>
      schema.questions.filter(
        (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
      ).length,
    [schema.questions],
  );

  const isAnswerBearing =
    selectedQuestion.type !== 'welcome' &&
    selectedQuestion.type !== 'thanks' &&
    selectedQuestion.type !== 'statement';

  const noop = () => {};
  // The preview's fields never pull the keyboard out of the inspector (S15).
  const focusGuard = usePreviewFocusGuard();

  return (
    <section className="slate-canvas">
      <div className="slate-canvas-toolbar">
        <span className="slate-canvas-label">
          Live preview · {labelForQuestion(selectedQuestion)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {forced ? (
            <span className="slate-badge" title="This form always shows in this mode">
              {schema.themeMode === 'dark' ? 'Always dark' : 'Always light'}
            </span>
          ) : (
            <div className="slate-tabs" role="tablist" aria-label="Preview mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'light'}
                className={`slate-tab${mode === 'light' ? ' slate-tab--active' : ''}`}
                onClick={() => setMode('light')}
              >
                Light
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'dark'}
                className={`slate-tab${mode === 'dark' ? ' slate-tab--active' : ''}`}
                onClick={() => setMode('dark')}
              >
                Dark
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="slate-canvas-frame" {...focusGuard}>
        <div
          data-slate-forms=""
          data-theme-name={schema.theme}
          data-theme={mode}
          {...(hasStepDecorationBackdrop(decoration) ? { 'data-has-decoration': '' } : {})}
          ref={scrollerRef}
          // minHeight 0 beats the form's own `min-height: 100vh` (base.css), so the
          // scroller is the frame's height and its last pixels (OK) can be reached.
          style={{
            height: '100%',
            minHeight: 0,
            width: '100%',
            overflowX: 'hidden',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
          }}
        >
          <ThemeDecoration themeName={schema.theme} step={stepIndex} />
          <ProgressBar value={progressPct} />
          <TopBar
            brandName={schema.brand.name}
            brandLogo={schema.brand.logo}
            showBack={false}
            onBack={noop}
          />

          <div className="slate-stage" style={{ minHeight: 'auto', padding: '48px 24px 120px' }}>
            <div
              key={`${selectedQuestion.id}:${tryKey}`}
              className="slate-stage-content"
              style={{ minHeight: 'auto' }}
            >
              <QuestionRenderer
                question={selectedQuestion}
                answers={answers}
                setAnswer={setAnswer}
                advance={restartTry}
                stepNumber={stepNumber}
                totalSteps={totalSteps}
                submitStatus={selectedQuestion.type === 'thanks' ? 'success' : 'idle'}
                submitError={null}
                onRetrySubmit={noop}
                onRestart={noop}
                onFileUpload={hostFileUpload}
                resolveFileUploadMeta={resolveUploadMeta}
                allQuestions={schema.questions}
                estimate={previewEstimate}
                estimateSettings={schema.estimate}
                slotsLeft={slotsLeft}
              />
            </div>
          </div>

          {isAnswerBearing && totalSteps > 0 && (
            <FooterCounter current={stepNumber} total={totalSteps} />
          )}
        </div>
      </div>
    </section>
  );
}

/** The question's type ("Number", "Pin the Spot"), never its internal id (QA S9, CH-17, F25). */
export function labelForQuestion(q: Question): string {
  return TYPE_LABEL[q.type] ?? 'Question';
}
