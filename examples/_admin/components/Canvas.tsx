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

import { useEffect, useMemo, useState } from 'react';
import type { Question, Schema, ThemeMode, ResolvedThemeMode } from '@/index.js';
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
import { getLocalUploadMeta } from '../localFileStore.js';
import { TYPE_LABEL } from '../questionTypeMeta.js';

import '@/styles/tokens.css';
import '@/styles/toggle.css';
import '@/styles/animations.css';
import '@/styles/base.css';
import '@/styles/questions.css';

type Props = {
  schema: Schema;
  selectedQuestion: Question;
};

function defaultMode(themeMode: ThemeMode): ResolvedThemeMode {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function Canvas({ schema, selectedQuestion }: Props) {
  const forced = schema.themeMode === 'light' || schema.themeMode === 'dark';
  const [mode, setMode] = useState<ResolvedThemeMode>(() => defaultMode(schema.themeMode));

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
  const noopWith = () => {};

  return (
    <section className="slate-canvas">
      <div className="slate-canvas-toolbar">
        <span className="slate-canvas-label">Live preview · {labelForQuestion(selectedQuestion)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {forced ? (
            <span className="slate-badge" title="Schema forces this mode">
              {schema.themeMode === 'dark' ? 'Forced dark' : 'Forced light'}
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

      <div className="slate-canvas-frame">
        <div
          data-slate-forms=""
          data-theme-name={schema.theme}
          data-theme={mode}
          {...(hasStepDecorationBackdrop(decoration) ? { 'data-has-decoration': '' } : {})}
          style={{ height: '100%', width: '100%' }}
        >
          <ThemeDecoration themeName={schema.theme} step={stepIndex} />
          <ProgressBar value={progressPct} />
          <TopBar brandName={schema.brand.name} showBack={false} onBack={noop} />

          <div className="slate-stage" style={{ minHeight: 'auto', padding: '48px 24px' }}>
            <div
              key={selectedQuestion.id}
              className="slate-stage-content"
              style={{ minHeight: 'auto' }}
            >
              <QuestionRenderer
                question={selectedQuestion}
                answers={{}}
                setAnswer={noopWith}
                advance={noop}
                stepNumber={stepNumber}
                totalSteps={totalSteps}
                submitStatus={selectedQuestion.type === 'thanks' ? 'success' : 'idle'}
                submitError={null}
                onRetrySubmit={noop}
                onRestart={noop}
                onFileUpload={hostFileUpload}
                resolveFileUploadMeta={getLocalUploadMeta}
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

function labelForQuestion(q: Question): string {
  if (q.type === 'welcome' || q.type === 'thanks' || q.type === 'statement') {
    return TYPE_LABEL[q.type];
  }
  return q.id;
}
