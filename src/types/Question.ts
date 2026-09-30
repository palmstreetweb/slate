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

/**
 * Prefill from the page link (ADR-063). When set, `?{prefillKey}=…` on the
 * fill link (passed to `<Form prefill>`) fills this answer before the
 * respondent starts. The respondent still sees and can change it. Unset =
 * never prefilled. Consent (`legal`), files, rankings and grids can't be
 * prefilled.
 */
type Prefill = {
  prefillKey?: string;
};

/**
 * Free-text "Other" on choice questions (ADR-063). The respondent picks
 * Other and types; the typed text is stored in place of an option value
 * (text that names an option is stored as that option). In conditions,
 * `OTHER_VALUE` means "picked Other".
 */
type OtherChoice = {
  allowOther?: boolean;
  /** Label of the Other choice; default 'Other'. */
  otherLabel?: string;
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

/**
 * Review screen (roadmap Phase 5) — chrome step, usually placed right before
 * `thanks`. Lists every visible answered question with a jump-to-edit link.
 * Stores no answer.
 */
export type ReviewQuestion<TId extends string = string> = IdField<TId> & {
  type: 'review';
  title: string;
  subtitle?: string;
  /** Confirm button label; default "Looks good". */
  cta?: string;
  visibleIf?: Condition;
};

/* ---------- text input questions ---------- */

export type ShortTextQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'short_text';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    maxLength?: number;
    pattern?: RegExp;
    patternError?: string;
  };

export type LongTextQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'long_text';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    maxLength?: number;
  };

export type EmailQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'email';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
  };

export type UrlQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'url';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
  };

export type PhoneQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'phone';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    /** ISO 3166-1 alpha-2 country code; default 'US'. Stored as E.164. */
    defaultCountry?: string;
  };

/* ---------- numeric input ---------- */

/** How a `number` question is drawn (ADR-063). */
export type NumberDisplay = 'input' | 'stepper';

export type NumberQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'number';
    title: DynamicTitle;
    placeholder?: string;
    required?: boolean;
    min?: number;
    max?: number;
    step?: number;
    /** 'input' (default) is a typed number; 'stepper' adds big − / + buttons. */
    display?: NumberDisplay;
    /** Shown before the number, e.g. '$'. Display only — the answer stays a number. */
    prefix?: string;
    /** Shown after the number, e.g. 'sq ft'. Display only. */
    unit?: string;
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
    /** When true (default), answer is `(File | string)[]` and the field allows adding more (ADR-032). Set `false` for single-file. */
    multiple?: boolean;
    /** Cap on attachments when `multiple` (default 10). */
    maxFiles?: number;
  };

/* ---------- date ---------- */

export type DateQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'date';
    title: DynamicTitle;
    required?: boolean;
    /** Display order of the segmented inputs; default 'MM/DD/YYYY'. */
    format?: 'MM/DD/YYYY' | 'DD/MM/YYYY';
    /** Inclusive bounds, ISO `YYYY-MM-DD`. Apply to both ends of a range. */
    min?: string;
    max?: string;
    /**
     * Also ask for a time of day (ADR-063). Stored as `YYYY-MM-DDTHH:MM`
     * (24-hour wall clock, no time zone). 12-hour entry for MM/DD/YYYY forms.
     */
    includeTime?: boolean;
    /**
     * Ask for a start and an end (ADR-063). Stored as one ISO 8601 interval
     * string, `start/end` — e.g. `2026-10-03/2026-10-07`.
     */
    range?: boolean;
  };

/* ---------- choice questions ---------- */

export type SingleChoiceQuestion<
  TId extends string = string,
  TOptions extends ReadonlyArray<Option> = ReadonlyArray<Option>,
> = IdField<TId> &
  Visibility &
  Prefill &
  OtherChoice & {
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
  Visibility &
  Prefill &
  OtherChoice & {
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
  Visibility &
  Prefill &
  OtherChoice & {
    type: 'dropdown';
    title: DynamicTitle;
    options: TOptions;
    placeholder?: string;
    /** Defaults to true. */
    required?: boolean;
  };

/** Binary yes/no. Stored as `'yes' | 'no'`. */
export type YesNoQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
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
  Visibility &
  Prefill &
  OtherChoice & {
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

/** How a `scale` question is drawn (ADR-063). The answer is the same number in every style. */
export type ScaleDisplay = 'numbers' | 'stars' | 'emoji' | 'slider';

export type ScaleQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
    type: 'scale';
    title: DynamicTitle;
    min: number;
    max: number;
    minLabel?: string;
    maxLabel?: string;
    step?: number;
    required?: boolean;
    /** Default 'numbers'. Stars and faces work best up to 7 points. */
    display?: ScaleDisplay;
    /** Slider only: what reacts above the thumb while dragging; default 'emoji'. */
    sliderIcon?: 'emoji' | 'stars' | 'none';
  };

/** Net Promoter Score — fixed 0–10 scale with standard anchors. */
export type NpsQuestion<TId extends string = string> = IdField<TId> &
  Visibility &
  Prefill & {
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
  | ReviewQuestion
  | ThanksQuestion;

export type QuestionType = Question['type'];

/** Question types that contribute an entry to the Answers payload. */
export type StoredQuestionType = Exclude<
  QuestionType,
  'welcome' | 'statement' | 'review' | 'thanks'
>;

/** Type guard — narrows a Question to a specific variant by its `type` discriminant. */
export function isQuestionType<T extends QuestionType>(
  q: Question,
  type: T,
): q is Extract<Question, { type: T }> {
  return q.type === type;
}
