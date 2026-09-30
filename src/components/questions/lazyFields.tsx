/**
 * Field UIs that load on demand (ADR-063). The engine's core chunk keeps the
 * field every question type starts with; heavier variants (star and face
 * scales, the slider, the stepper, date ranges and times — and the new types
 * in later waves) live in their own chunks under `./ext/` and load only for a
 * schema that uses them.
 *
 * `<Form>` calls `preloadExtFields(schema.questions)` on mount, so a chunk
 * usually lands while the respondent is still on the welcome screen. Until it
 * does, the question shows its title and a quiet placeholder of the same
 * height; if it can't load (offline), a Retry button — never a blank form.
 *
 * Adding a UI: give it a key, a loader and a line in `extFieldKey`.
 */

'use client';

import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';
import type { LooseAnswers } from '@/types/Answers.js';
import type { Question } from '@/types/Question.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import type { FileUploadMeta } from '@/utils/fileUploadRef.js';

/** The one prop contract every on-demand field implements. */
export type ExtFieldProps<Q extends Question = Question> = {
  question: Q;
  answers: LooseAnswers;
  /** The stored answer (undefined when unanswered). */
  value: LooseAnswers[string];
  /** Store the answer; no navigation. */
  onAnswer: (value: LooseAnswers[string]) => void;
  /** Store the answer and auto-advance after the ~220 ms commit beat. */
  onCommit: (value: LooseAnswers[string]) => void;
  /** Move on; the field has already validated and stored its answer. */
  onAdvance: () => void;
  /** Typewriter tick while typing (ADR-034). */
  onType?: () => void;
  /** The form's step sound on a discrete interaction (ADR-023). */
  ping?: () => void;
  /** Host storage for fields that take files (ADR-012). */
  onFileUpload?: FileUploadHandler;
  resolveFileUploadMeta?: (ref: string) => Promise<FileUploadMeta | null>;
};

// The registry holds components for different question variants; each loader
// knows its own question type, so the map itself is loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExtField = ComponentType<ExtFieldProps<any>>;

export type ExtFieldKey = 'file-upload' | 'scale-styled' | 'number-stepper' | 'date-extended';

const LOADERS: Record<ExtFieldKey, () => Promise<{ default: AnyExtField }>> = {
  'file-upload': () => import('./ext/FileUploadExt.js'),
  'scale-styled': () => import('./ext/ScaleStyledField.js'),
  'number-stepper': () => import('./ext/NumberStepperField.js'),
  'date-extended': () => import('./ext/DateExtField.js'),
};

/** The on-demand UI a question needs, or null for its core field. */
export function extFieldKey(q: Question): ExtFieldKey | null {
  switch (q.type) {
    case 'file_upload':
      return 'file-upload';
    case 'scale':
      return q.display === 'stars' || q.display === 'emoji' || q.display === 'slider'
        ? 'scale-styled'
        : null;
    case 'number':
      return q.display === 'stepper' ? 'number-stepper' : null;
    case 'date':
      return q.range || q.includeTime ? 'date-extended' : null;
    default:
      return null;
  }
}

const loading = new Map<ExtFieldKey, Promise<{ default: AnyExtField }>>();

function load(key: ExtFieldKey): Promise<{ default: AnyExtField }> {
  let p = loading.get(key);
  if (!p) {
    p = LOADERS[key]();
    // A failed download is retried on the next request, not cached forever.
    p.catch(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

const components = new Map<ExtFieldKey, AnyExtField>();

function componentFor(key: ExtFieldKey): AnyExtField {
  let c = components.get(key);
  if (!c) {
    c = lazy(() => load(key));
    components.set(key, c);
  }
  return c;
}

/** Start downloading every on-demand UI these questions use. Safe to call often. */
export function preloadExtFields(questions: ReadonlyArray<Question>): void {
  const keys = new Set<ExtFieldKey>();
  for (const q of questions) {
    const key = extFieldKey(q);
    if (key) keys.add(key);
  }
  keys.forEach((key) => {
    load(key).catch(() => {
      /* the field shows its own Retry */
    });
  });
}

type BoundaryProps = { title: string; onRetry: () => void; children: ReactNode };

/** A chunk that fails to download shows Retry instead of unmounting the form. */
class ExtFieldBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div>
        <h1 className="slate-title">{this.props.title}</h1>
        <p className="slate-err" role="alert">
          ! This question didn’t load. Check your connection.
        </p>
        <div className="slate-actions">
          <button type="button" className="slate-ok-btn" onClick={this.props.onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }
}

/** Title + a placeholder the height of a typical field, while the chunk loads. */
function Loading({ title }: { title: string }) {
  return (
    <div aria-busy="true">
      <h1 className="slate-title">{title}</h1>
      <div className="slate-ext-loading" aria-hidden="true" />
    </div>
  );
}

/** Render the on-demand UI for `extKey`, with a loading state and a Retry. */
export function ExtField({ extKey, ...props }: ExtFieldProps & { extKey: ExtFieldKey }) {
  const [attempt, setAttempt] = useState(0);
  const title = typeof props.question.title === 'string' ? props.question.title : '';
  const Field = componentFor(extKey);
  return (
    <ExtFieldBoundary
      key={attempt}
      title={title}
      onRetry={() => {
        components.delete(extKey);
        setAttempt((n) => n + 1);
      }}
    >
      <Suspense fallback={<Loading title={title} />}>
        <Field {...props} />
      </Suspense>
    </ExtFieldBoundary>
  );
}
