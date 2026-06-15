/**
 * Schema, Form props, and submit metadata. The Schema is the source-of-truth
 * shape passed into `<Form>`. `defineSchema` is the const-inferring identity
 * helper that lets these generics carry literal types end-to-end.
 */

import type { Question } from './Question.js';
import type { AnswersOf, HiddenFields, LooseAnswers } from './Answers.js';
import type { ThemeMode, ThemeName } from './Theme.js';
import type { FormSound } from './Sound.js';
import type { FileUploadMeta } from '@/utils/fileUploadRef.js';

export type BrandConfig = {
  name: string;
  /** URL or path to a brand logo. Optional. */
  logo?: string;
};

/**
 * Top-level form schema. Generic over the questions tuple so that
 * `defineSchema` can preserve literal IDs, option values, and `required`
 * flags for downstream inference.
 */
export type Schema<Q extends ReadonlyArray<Question> = ReadonlyArray<Question>> = {
  /**
   * Stable form identifier. Namespaces the save-and-resume autosave key
   * (`slate-forms-resume:<id>`, ADR-017). Required when `<Form resume>` is set.
   */
  id?: string;
  brand: BrandConfig;
  /** Built-in theme name, or a custom string when consumers register their own. */
  theme: ThemeName | (string & {});
  themeMode: ThemeMode;
  /**
   * Step confirmation sound on forward navigation (ADR-023). One of ten built-in
   * synthesized presets, or `'off'` / omit for silent. Legacy `true` maps to
   * `'pixie-mallet'`.
   */
  sound?: FormSound | boolean;
  questions: Q;
};

/** Metadata passed to `onPartialChange` while the form is in progress. */
export type PartialMeta = {
  startedAt: Date;
  /** The question being shown when this change happened. */
  lastQuestionId: string;
  /** Ordered IDs of questions shown so far. */
  questionsVisited: string[];
  hiddenFields: HiddenFields;
  /** Running score total (ADR-016). */
  score: number;
};

/** Metadata passed to `onSubmit` alongside the answers payload. */
export type SubmitMeta = {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  /** Ordered IDs of questions that were actually shown to the user. */
  questionsVisited: string[];
  /** Hidden-field passthrough (UTM tags, server-injected IDs, etc.). */
  hiddenFields: HiddenFields;
  /** Total of option-level `score` values for the selected answers (ADR-016). */
  score: number;
};

/**
 * Props for the `<Form>` component. Generic over the schema so that consumers
 * get strongly-typed `answers` in their `onSubmit` and `onQuestionChange`
 * callbacks when the schema was built with `defineSchema`.
 */
export type FormProps<S extends Schema = Schema> = {
  schema: S;
  onSubmit: (
    answers: S extends Schema<infer Q> ? AnswersOf<Q> : LooseAnswers,
    meta: SubmitMeta,
  ) => void | Promise<void>;
  onQuestionChange?: (
    questionId: string,
    answers: S extends Schema<infer Q> ? AnswersOf<Q> : LooseAnswers,
  ) => void;
  hiddenFields?: HiddenFields;
  /** Override the fallback message shown when `onSubmit` rejects. */
  errorMessage?: string;
  /**
   * Host-controlled storage for `file_upload` questions (ADR-012). Called
   * with the selected File; the resolved string (URL or identifier) is
   * stored as the answer. When omitted, the raw `File` object is stored
   * and delivered in the `onSubmit` payload.
   */
  onFileUpload?: (file: File, questionId: string, ctx?: { maxSizeMb?: number }) => Promise<string>;
  /**
   * Resolve display metadata for opaque upload refs (e.g. `slate-file://…`).
   * Optional; without it, refs show a generic label after reload.
   */
  resolveFileUploadMeta?: (ref: string) => Promise<FileUploadMeta | null>;
  /**
   * Save-and-resume (ADR-017). When set, in-progress answers autosave to
   * `localStorage` under `slate-forms-resume:<schema.id>`, a "resume where
   * you left off?" prompt appears on remount, and the save is cleared on
   * successful submit. Requires `schema.id`.
   */
  resume?: boolean;
  /**
   * Fires whenever an answer changes — abandonment capture for hosts that
   * want partial responses. Receives the same visibility-filtered answers
   * payload as `onSubmit`.
   */
  onPartialChange?: (
    answers: S extends Schema<infer Q> ? Partial<AnswersOf<Q>> : LooseAnswers,
    meta: PartialMeta,
  ) => void;
};
