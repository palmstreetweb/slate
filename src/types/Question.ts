/**
 * Discriminated union of every question type the engine can render. The `type`
 * field is the discriminant; each variant lists its own schema additions.
 *
 * See `BUILD_BRIEF.md` §5 for the canonical table.
 */

import type { LooseAnswers } from './Answers.js';

export type Option<TValue extends string = string> = {
  label: string;
  value: TValue;
  description?: string;
  /** Points added to the running score when this option is selected (ADR-016). */
  score?: number;
};

/** Option with an image, for `picture_choice`. */
export type PictureOption<TValue extends string = string> = Option<TValue> & {
  /** Image URL. */
  src: string;
  /** Accessible alt text; falls back to the label. */
  alt?: string;
};

export type Condition =
  | { field: string; op: 'equals' | 'not_equals'; value: string | number }
  | { field: string; op: 'in' | 'not_in'; value: ReadonlyArray<string | number> }
  | { field: string; op: 'gt' | 'lt' | 'gte' | 'lte'; value: number }
  | { field: string; op: 'is_empty' | 'is_not_empty' }
  | { all: ReadonlyArray<Condition> }
  | { any: ReadonlyArray<Condition> };

/**
 * Title can be a static string or a function called with the current answers
 * for personalization. Allowed on every answer-bearing question type
 * (brief §5 listed text/email/phone/choice; number + scale were extended
 * to match in the Typeform-parity roadmap, Phase 1).
 */
export type DynamicTitle = string | ((answers: LooseAnswers) => string);

/**
 * Logic jump rule (ADR-015). Evaluated when the user advances *from* the
 * question that carries it; the first rule whose condition matches wins and
 * navigation goes to the question with id `goTo` (it must be visible).
 * No match → normal next-question flow.
 */
export type LogicRule = {
  if: Condition;
  goTo: string;
};

type IdField<TId extends string> = { id: TId };
type Visibility = {
  visibleIf?: Condition;
  /** Logic jumps, evaluated on advance (ADR-015). */
  logic?: ReadonlyArray<LogicRule>;
};

/* ---------- chrome screens (no answer stored) ---------- */

export type WelcomeQuestion<TId extends string = string> = IdField<TId> & {
  type: 'welcome';
  title: string;
  subtitle?: string;
  cta?: string;
};

export type StatementQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'statement';
    title: string;
    body?: string;
    cta?: string;
  };

export type ThanksQuestion<TId extends string = string> = IdField<TId> & {
  type: 'thanks';
  title: string;
  subtitle?: string;
  cta?: string;
  /**
   * Multiple-endings support (ADR-016): several thanks screens may coexist;
   * the first one whose `visibleIf` passes (or that has none) is shown.
   */
  visibleIf?: Condition;
  /** Navigate the page here after a successful submit. */
  redirectUrl?: string;
};

/* ---------- text input questions ---------- */

export type ShortTextQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'short_text';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    maxLength?: number;
    pattern?: RegExp;
    patternError?: string;
  };

export type LongTextQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'long_text';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    maxLength?: number;
  };

export type EmailQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'email';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
  };

export type UrlQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'url';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
  };

export type PhoneQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'phone';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    /** ISO 3166-1 alpha-2 country code; default 'US'. Stored as E.164. */
    defaultCountry?: string;
  };

/* ---------- numeric input ---------- */

export type NumberQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'number';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    min?: number;
    max?: number;
    step?: number;
  };

/* ---------- file upload ---------- */

export type FileUploadQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'file_upload';
    title: DynamicTitle;
    required?: boolean;
    /** Native `accept` attribute value, e.g. `'image/*,.pdf'`. */
    accept?: string;
    /** Client-side max size in megabytes, checked at selection time. */
    maxSizeMb?: number;
  };

/* ---------- date ---------- */

export type DateQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'date';
    title: DynamicTitle;
    required?: boolean;
    /** Display order of the segmented inputs; default 'MM/DD/YYYY'. */
    format?: 'MM/DD/YYYY' | 'DD/MM/YYYY';
    /** Inclusive bounds, ISO `YYYY-MM-DD`. */
    min?: string;
    max?: string;
  };

/* ---------- choice questions ---------- */

export type SingleChoiceQuestion<
  TId extends string = string,
  TOptions extends ReadonlyArray<Option> = ReadonlyArray<Option>,
> = IdField<TId> &
  Visibility & {
    type: 'single_choice';
    title: DynamicTitle;
    options: TOptions;
    /** Defaults to true. */
    required?: boolean;
  };

export type MultiChoiceQuestion<
  TId extends string = string,
  TOptions extends ReadonlyArray<Option> = ReadonlyArray<Option>,
> = IdField<TId> &
  Visibility & {
    type: 'multi_choice';
    title: DynamicTitle;
    options: TOptions;
    min?: number;
    max?: number;
  };

/** Searchable select — Typeform-style dropdown for long option lists. */
export type DropdownQuestion<
  TId extends string = string,
  TOptions extends ReadonlyArray<Option> = ReadonlyArray<Option>,
> = IdField<TId> &
  Visibility & {
    type: 'dropdown';
    title: DynamicTitle;
    options: TOptions;
    placeholder?: string;
    /** Defaults to true. */
    required?: boolean;
  };

/** Binary yes/no. Stored as `'yes' | 'no'`. */
export type YesNoQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'yes_no';
    title: DynamicTitle;
    yesLabel?: string;
    noLabel?: string;
    /** Defaults to true. */
    required?: boolean;
  };

/**
 * Image-grid choice. Single-select by default (auto-advance, required
 * unless `required: false`); `multiple: true` switches to toggle-and-OK
 * with optional `min`/`max` selection bounds.
 */
export type PictureChoiceQuestion<
  TId extends string = string,
  TOptions extends ReadonlyArray<PictureOption> = ReadonlyArray<PictureOption>,
> = IdField<TId> &
  Visibility & {
    type: 'picture_choice';
    title: DynamicTitle;
    options: TOptions;
    multiple?: boolean;
    /** Single-select only; defaults to true. */
    required?: boolean;
    /** Multi-select only. */
    min?: number;
    max?: number;
  };

/** Reorder a list. Stored as the full ordered array of option values. */
export type RankingQuestion<
  TId extends string = string,
  TOptions extends ReadonlyArray<Option> = ReadonlyArray<Option>,
> = IdField<TId> &
  Visibility & {
    type: 'ranking';
    title: DynamicTitle;
    /** Initial order. */
    options: TOptions;
  };

/**
 * Rows x columns grid (Google Forms style). One answer per row
 * (radio cells), or multiple per row with `multiple: true` (checkboxes).
 * Stored as `Record<rowValue, columnValue | columnValue[]>`.
 */
export type MatrixQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'matrix';
    title: DynamicTitle;
    rows: ReadonlyArray<Option>;
    columns: ReadonlyArray<Option>;
    multiple?: boolean;
    /** Require every row to be answered. */
    required?: boolean;
  };

/** Legal/consent accept-or-decline. Stored as `'accept' | 'decline'`. */
export type LegalQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'legal';
    title: DynamicTitle;
    /** Longer terms/consent copy shown under the title. */
    body?: string;
    acceptLabel?: string;
    declineLabel?: string;
    /** Defaults to true. */
    required?: boolean;
  };

/* ---------- scale ---------- */

export type ScaleQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'scale';
    title: DynamicTitle;
    min: number;
    max: number;
    minLabel?: string;
    maxLabel?: string;
    step?: number;
    required?: boolean;
  };

/** Net Promoter Score — fixed 0–10 scale with standard anchors. */
export type NpsQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'nps';
    title: DynamicTitle;
    /** Defaults to 'Not at all likely'. */
    minLabel?: string;
    /** Defaults to 'Extremely likely'. */
    maxLabel?: string;
    required?: boolean;
  };

/* ---------- the union ---------- */

export type Question =
  | WelcomeQuestion
  | StatementQuestion
  | ShortTextQuestion
  | LongTextQuestion
  | EmailQuestion
  | PhoneQuestion
  | UrlQuestion
  | NumberQuestion
  | DateQuestion
  | FileUploadQuestion
  | SingleChoiceQuestion
  | MultiChoiceQuestion
  | DropdownQuestion
  | PictureChoiceQuestion
  | RankingQuestion
  | MatrixQuestion
  | YesNoQuestion
  | LegalQuestion
  | ScaleQuestion
  | NpsQuestion
  | ThanksQuestion;

export type QuestionType = Question['type'];

/** Question types that contribute an entry to the Answers payload. */
export type StoredQuestionType = Exclude<QuestionType, 'welcome' | 'statement' | 'thanks'>;

/** Type guard — narrows a Question to a specific variant by its `type` discriminant. */
export function isQuestionType<T extends QuestionType>(
  q: Question,
  type: T,
): q is Extract<Question, { type: T }> {
  return q.type === type;
}
