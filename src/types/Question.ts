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

type IdField<TId extends string> = { id: TId };
type Visibility = { visibleIf?: Condition };

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

/* ---------- the union ---------- */

export type Question =
  | WelcomeQuestion
  | StatementQuestion
  | ShortTextQuestion
  | LongTextQuestion
  | EmailQuestion
  | PhoneQuestion
  | NumberQuestion
  | SingleChoiceQuestion
  | MultiChoiceQuestion
  | ScaleQuestion
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
