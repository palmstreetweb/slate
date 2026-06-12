/**
 * Schema, Form props, and submit metadata. The Schema is the source-of-truth
 * shape passed into `<Form>`. `defineSchema` is the const-inferring identity
 * helper that lets these generics carry literal types end-to-end.
 */

import type { Question } from './Question.js';
import type { AnswersOf, HiddenFields, LooseAnswers } from './Answers.js';
import type { ThemeMode, ThemeName } from './Theme.js';

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
  brand: BrandConfig;
  /** Built-in theme name, or a custom string when consumers register their own. */
  theme: ThemeName | (string & {});
  themeMode: ThemeMode;
  questions: Q;
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
  onFileUpload?: (file: File, questionId: string) => Promise<string>;
};
