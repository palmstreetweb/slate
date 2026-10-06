/**
 * Schema, Form props, and submit metadata. The Schema is the source-of-truth
 * shape passed into `<Form>`. `defineSchema` is the const-inferring identity
 * helper that lets these generics carry literal types end-to-end.
 */

import type { Question } from './Question.js';
import type { AnswersOf, HiddenFields, LooseAnswers } from './Answers.js';
import type { ThemeMode, ThemeName } from './Theme.js';
import type { FormSound } from './Sound.js';
import type { Estimate, EstimateSettings } from './Estimate.js';
import type { FileUploadMeta } from '@/utils/fileUploadRef.js';

export type BrandConfig = {
  name: string;
  /**
   * URL or path to a brand logo, shown left of `name` in the top chrome.
   * Optional. Rendered only for an `https:` URL, a same-origin `/path`, or a
   * base64 PNG/JPEG/WebP/GIF `data:` URL; anything else, or an image that
   * fails to load, falls back to the name alone.
   */
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
   * `'pixie-mallet'`. When a preset is on, text fields also play soft typewriter
   * key ticks while typing (ADR-034).
   */
  sound?: FormSound | boolean;
  /**
   * Instant estimate settings (ADR-064): currency, a base price, and how the
   * Thank You screen shows it. Prices live on options (`price`, `priceMax`)
   * and number questions (`unitPrice`); an ending shows the estimate with
   * `showEstimate`.
   */
  estimate?: EstimateSettings;
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
  /**
   * The instant estimate for these answers (ADR-064), when the schema has
   * prices. A server that stores responses should recompute it from its own
   * copy of the schema rather than trust this value.
   */
  estimate?: Estimate;
  /**
   * One id per fill (a UUID; ADR-070): the same on every try to send it —
   * Retry, a question the submit sent the respondent back to, and with
   * `resume`, a reload and Resume — and new for "Submit another" or Start
   * over. A server can store it as a retry key, so a submit that landed but
   * whose reply was lost is never stored twice. Missing where the browser
   * can't make one (a page not served over https).
   */
  fillId?: string;
};

/**
 * Spots left per sign-up slot (ADR-066): question id → slot value → spots
 * left (0 = full). A host that stores responses passes what its server
 * reports; slots it doesn't mention show their capacity.
 */
export type SlotsLeft = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * Props for the `<Form>` component. Generic over the schema so that consumers
 * get strongly-typed `answers` in their `onSubmit` and `onQuestionChange`
 * callbacks when the schema was built with `defineSchema`.
 */
export type FormProps<S extends Schema = Schema> = {
  schema: S;
  /**
   * Called once on reaching an ending. A rejection shows its message with a
   * Retry. A rejection whose error carries `goTo` (a question id) instead
   * returns the respondent to that question with the message shown there and
   * every answer kept — e.g. a sign-up slot that filled while they were
   * answering (ADR-066).
   */
  onSubmit: (
    answers: S extends Schema<infer Q> ? AnswersOf<Q> : LooseAnswers,
    meta: SubmitMeta,
  ) => void | Promise<void>;
  onQuestionChange?: (
    questionId: string,
    answers: S extends Schema<infer Q> ? AnswersOf<Q> : LooseAnswers,
  ) => void;
  hiddenFields?: HiddenFields;
  /**
   * Answers from the page link (ADR-063), e.g. the fill page's URL
   * parameters. Only questions with a matching `prefillKey` are filled, each
   * value is checked against its question (bad values are ignored), and the
   * respondent still sees and can change every prefilled answer. Read once,
   * when the form mounts.
   */
  prefill?: Readonly<Record<string, string | undefined>>;
  /** Override the fallback message shown when `onSubmit` rejects. */
  errorMessage?: string;
  /**
   * Live spots left on sign-up slots (ADR-066). Update it any time (e.g. from
   * a 409 when a slot filled); a slot the respondent picked that is now full
   * asks them to pick another.
   */
  slotsLeft?: SlotsLeft;
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
   *
   * `'tab'` keeps the save in `sessionStorage` instead: it survives a reload,
   * back / forward and a phone discarding the tab, and goes with the tab
   * when the browser copies it — a duplicated tab, a closed tab reopened, a
   * restored session. It is never offered after 30 minutes without an
   * answer, and Start over deletes it (ADR-017 addendum).
   *
   * With either, a question whose part didn't download may reload the page
   * when the respondent taps Try again, since the answers come back; without
   * `resume` the form never reloads the page.
   */
  resume?: boolean | 'tab';
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
