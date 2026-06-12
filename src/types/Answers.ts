/**
 * Answer types — both the runtime-loose shape (`LooseAnswers` / `Answers`) and
 * the strongly-typed `AnswersOf<Q>` derived from a const-inferred questions
 * tuple via `defineSchema`.
 */

import type {
  Question,
  Option,
  StoredQuestionType,
  ShortTextQuestion,
  LongTextQuestion,
  EmailQuestion,
  PhoneQuestion,
  UrlQuestion,
  NumberQuestion,
  DateQuestion,
  FileUploadQuestion,
  ScaleQuestion,
  NpsQuestion,
  SingleChoiceQuestion,
  MultiChoiceQuestion,
  DropdownQuestion,
  PictureChoiceQuestion,
  RankingQuestion,
  MatrixQuestion,
  YesNoQuestion,
  LegalQuestion,
} from './Question.js';

/**
 * Loose, runtime-shaped answers map. Used wherever code doesn't have access to
 * the const-inferred schema tuple (e.g. inside a title function, or in a
 * generic helper). For strongly-typed access at the consumer's `onSubmit`,
 * see `AnswersOf<Q>`.
 *
 * Per brief §6 (+ Typeform-parity roadmap additions):
 *   - short_text, long_text, email, phone, url → string
 *   - date → string (ISO `YYYY-MM-DD`)
 *   - number, scale, nps → number
 *   - single_choice, dropdown → string (the option `value`)
 *   - multi_choice, ranking → string[] (option `value`s; full order for ranking)
 *   - picture_choice → string, or string[] when `multiple: true`
 *   - yes_no → 'yes' | 'no'
 *   - legal → 'accept' | 'decline'
 *   - file_upload → File, or string when the host uploads via `onFileUpload`
 *   - matrix → Record<rowValue, columnValue | columnValue[]> (see ADR-013)
 *   - welcome, statement, thanks → never stored
 */

/** A `file_upload` answer — the raw File, or the host's URL/id after upload. */
export type FileAnswer = File | string;

/** A `matrix` answer — row value → selected column value(s). */
export type MatrixAnswer = Record<string, string | string[]>;

export type LooseAnswers = Record<
  string,
  string | string[] | number | File | MatrixAnswer | undefined
>;

/** Public alias — what the brief calls `Answers`. */
export type Answers = LooseAnswers;

/** Hidden fields passed via `<Form hiddenFields={{ ... }} />`. Never rendered. */
export type HiddenFields = Record<string, unknown>;

/* ---------- per-question answer value derivation ---------- */

type OptionValueOf<TOptions> = TOptions extends ReadonlyArray<Option<infer V>> ? V : string;

/** Resolves a single question to its stored answer value type (no `undefined`). */
export type AnswerValueOf<Q extends Question> = Q extends ShortTextQuestion
  ? string
  : Q extends LongTextQuestion
    ? string
    : Q extends EmailQuestion
      ? string
      : Q extends PhoneQuestion
        ? string
        : Q extends UrlQuestion
          ? string
          : Q extends DateQuestion
            ? string
            : Q extends NumberQuestion
              ? number
              : Q extends ScaleQuestion
                ? number
                : Q extends NpsQuestion
                  ? number
                  : Q extends YesNoQuestion
                    ? 'yes' | 'no'
                    : Q extends LegalQuestion
                      ? 'accept' | 'decline'
                      : Q extends FileUploadQuestion
                        ? FileAnswer
                        : Q extends MatrixQuestion
                          ? MatrixAnswer
                          : Q extends RankingQuestion<string, infer TOpts>
                            ? Array<OptionValueOf<TOpts>>
                            : Q extends PictureChoiceQuestion<string, infer TOpts>
                              ? Q extends { multiple: true }
                                ? Array<OptionValueOf<TOpts>>
                                : OptionValueOf<TOpts>
                              : Q extends SingleChoiceQuestion<string, infer TOpts>
                                ? OptionValueOf<TOpts>
                                : Q extends DropdownQuestion<string, infer TOpts>
                                  ? OptionValueOf<TOpts>
                                  : Q extends MultiChoiceQuestion<string, infer TOpts>
                                    ? Array<OptionValueOf<TOpts>>
                                    : never;

/**
 * `required: true` on a question means its answer is guaranteed present at
 * submit time. Anything else may be `undefined`. `single_choice` defaults to
 * required:true per brief §5; `dropdown`, `yes_no`, and `legal` follow the
 * same default.
 */
type DefaultRequiredQuestion = SingleChoiceQuestion | DropdownQuestion | YesNoQuestion | LegalQuestion;

type IsRequired<Q extends Question> = Q extends { required: true }
  ? true
  : Q extends DefaultRequiredQuestion
    ? Q extends { required: false }
      ? false
      : true
    : false;

/* ---------- schema → strongly-typed answers map ---------- */

/**
 * Given a readonly tuple of questions (as produced by `defineSchema`), derive
 * the strongly-typed answers map. Non-stored questions are omitted; required
 * stored questions have non-undefined values; optional ones are `T | undefined`.
 */
export type AnswersOf<Q extends ReadonlyArray<Question>> = {
  [K in Q[number] as K extends { id: infer I extends string; type: StoredQuestionType }
    ? I
    : never]: IsRequired<K> extends true
    ? AnswerValueOf<K>
    : AnswerValueOf<K> | undefined;
};
