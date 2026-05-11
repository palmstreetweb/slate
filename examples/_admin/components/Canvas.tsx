/**
 * Center canvas — renders the currently-selected question exactly as a
 * respondent would see it. We bypass the full <Form> engine (no advance,
 * no submit, no navigation) and just mount the QuestionRenderer inside a
 * mock data-psw-forms wrapper with the schema's theme tokens.
 *
 * Mode is resolved from schema.themeMode, with a small Light/Dark
 * override pill so designers can preview both modes quickly when the
 * schema's themeMode is 'toggle' or 'auto'.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Question, Schema, ThemeMode, ResolvedThemeMode } from '@/index.js';
import { QuestionRenderer } from '@/components/questions/QuestionRenderer.js';

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

  const noop = () => {};
  const noopWith = () => {};

  return (
    <section className="studio-canvas">
      <div className="studio-canvas-toolbar">
        <span className="studio-canvas-label">Live preview · {labelForQuestion(selectedQuestion)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {forced ? (
            <span className="studio-badge" title="Schema forces this mode">
              {schema.themeMode === 'dark' ? 'Forced dark' : 'Forced light'}
            </span>
          ) : (
            <div className="studio-tabs" role="tablist" aria-label="Preview mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'light'}
                className={`studio-tab${mode === 'light' ? ' studio-tab--active' : ''}`}
                onClick={() => setMode('light')}
              >
                Light
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'dark'}
                className={`studio-tab${mode === 'dark' ? ' studio-tab--active' : ''}`}
                onClick={() => setMode('dark')}
              >
                Dark
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="studio-canvas-frame">
        <div
          data-psw-forms=""
          data-theme-name={schema.theme}
          data-theme={mode}
          style={{ height: '100%', width: '100%' }}
        >
          <div className="psw-stage" style={{ minHeight: 'auto', padding: '48px 24px' }}>
            <div
              key={selectedQuestion.id}
              className="psw-stage-content"
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
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function labelForQuestion(q: Question): string {
  if (q.type === 'welcome') return 'Welcome screen';
  if (q.type === 'thanks') return 'Thank you screen';
  if (q.type === 'statement') return 'Statement';
  return q.id;
}
