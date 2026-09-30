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
  ContactInfoQuestion,
  AddressQuestion,
  SignatureQuestion,
  ImagePinQuestion,
  VoiceNoteQuestion,
  LocationQuestion,
  PhotoChecklistQuestion,
  AvailabilityQuestion,
} from './Question.js';

/**
 * Loose, runtime-shaped answers map. Used wherever code doesn't have access to
 * the const-inferred schema tuple (e.g. inside a title function, or in a
 * generic helper). For strongly-typed access at the consumer's `onSubmit`,
 * see `AnswersOf<Q>`.
 *
 * Per brief §6 (+ Typeform-parity roadmap additions):
 *   - short_text, long_text, email, phone, url → string
 *   - date → string: ISO `YYYY-MM-DD`; `YYYY-MM-DDTHH:MM` with `includeTime`;
 *     `start/end` (ISO 8601 interval) with `range` (ADR-063)
 *   - number, scale, nps → number
 *   - single_choice, dropdown → string (the option `value`, or the typed
 *     "Other" text when `allowOther` — ADR-063)
 *   - multi_choice, ranking → string[] (option `value`s; full order for ranking;
 *     plus at most one typed "Other" text for multi_choice with `allowOther`)
 *   - picture_choice → string, or string[] when `multiple: true`
 *   - yes_no → 'yes' | 'no'
 *   - legal → 'accept' | 'decline'
 *   - file_upload → File | string, or (File | string)[] when `multiple: true` (ADR-032)
 *   - matrix → Record<rowValue, columnValue | columnValue[]> (see ADR-013)
 *   - contact_info → { name?, email?, phone? } (ADR-064)
 *   - address → { street, line2?, city, region?, postal, country? } (ADR-064)
 *   - signature → { path } (vector strokes) or { typed } (ADR-064)
 *   - image_pin → { pins: ['x,y', …], notes?, img? } (ADR-065)
 *   - voice_note → { audio, sec } (a stored file) or { typed } (ADR-065)
 *   - location → { lat, lng, area? } / { zip, area? } / { typed } (ADR-065)
 *   - photo_checklist → { [itemValue]: fileRef } (ADR-065)
 *   - availability → { [day]: 'HH:MM-HH:MM,…' } (ADR-065)
 *   - welcome, statement, thanks → never stored
 */

/** One attachment — raw File, or the host's URL/id after upload. */
export type FileAnswerItem = File | string;

/** A `file_upload` answer — single item, or an array when `multiple: true`. */
export type FileAnswer = FileAnswerItem | FileAnswerItem[];

/** A `matrix` answer — row value → selected column value(s). */
export type MatrixAnswer = Record<string, string | string[]>;

/** A `contact_info` answer — only the parts that were filled (ADR-064). */
export type ContactAnswer = { name?: string; email?: string; phone?: string };

/** An `address` answer — only the parts that were filled (ADR-064). */
export type AddressAnswer = {
  street?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
};

/**
 * A `signature` answer (ADR-064): `path` is the drawing as a compact SVG path
 * in a 500 × 200 box (`M x y l dx dy …`, whole numbers); `typed` is a name
 * typed instead.
 */
export type SignatureAnswer = { path: string } | { typed: string };

/**
 * An `image_pin` answer (ADR-065): pins as `'x,y'` (0–1, up to 4 decimals,
 * from the photo's top left), notes in the same order, and `img`, a short key
 * of the photo they were placed on (set by the server from the published form).
 */
export type ImagePinAnswer = { pins: string[]; notes?: string[]; img?: string };

/** A `voice_note` answer (ADR-065): a stored recording and its length, or typed text. */
export type VoiceNoteAnswer = { audio: string; sec?: string } | { typed: string };

/**
 * A `location` answer (ADR-065): coordinates rounded to 3 decimals, a ZIP code
 * typed instead, or a typed place; `area` is 'in' or 'out' when checkable.
 */
export type LocationAnswer =
  | { lat: string; lng: string; area?: 'in' | 'out' }
  | { zip: string; area?: 'in' | 'out' }
  | { typed: string };

/** A `photo_checklist` answer (ADR-065): item value → stored photo ref. */
export type PhotoChecklistAnswer = Record<string, string>;

/** An `availability` answer (ADR-065): day → free ranges, `'09:00-11:30,14:00-16:00'`. */
export type AvailabilityAnswer = Record<string, string>;

export type LooseAnswers = Record<
  string,
  string | string[] | number | File | FileAnswerItem[] | MatrixAnswer | undefined
>;

/** Public alias — what the brief calls `Answers`. */
export type Answers = LooseAnswers;

/** Hidden fields passed via `<Form hiddenFields={{ ... }} />`. Never rendered. */
export type HiddenFields = Record<string, unknown>;

/* ---------- per-question answer value derivation ---------- */

type OptionValueOf<TOptions> = TOptions extends ReadonlyArray<Option<infer V>> ? V : string;

/** With `allowOther: true` the answer may also be the respondent's own text (ADR-063). */
type WithOther<Q, V> = Q extends { allowOther: true } ? V | (string & {}) : V;

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
                        ? Q extends { multiple: true }
                          ? FileAnswerItem[]
                          : FileAnswerItem
                        : Q extends MatrixQuestion
                          ? MatrixAnswer
                          : Q extends ContactInfoQuestion
                            ? ContactAnswer
                            : Q extends AddressQuestion
                              ? AddressAnswer
                              : Q extends SignatureQuestion
                                ? SignatureAnswer
                                : Q extends ImagePinQuestion
                                  ? ImagePinAnswer
                                  : Q extends VoiceNoteQuestion
                                    ? VoiceNoteAnswer
                                    : Q extends LocationQuestion
                                      ? LocationAnswer
                                      : Q extends PhotoChecklistQuestion
                                        ? PhotoChecklistAnswer
                                        : Q extends AvailabilityQuestion
                                          ? AvailabilityAnswer
                                          : Q extends RankingQuestion<string, infer TOpts>
                                  ? Array<OptionValueOf<TOpts>>
                                  : Q extends PictureChoiceQuestion<string, infer TOpts>
                                    ? Q extends { multiple: true }
                                      ? Array<WithOther<Q, OptionValueOf<TOpts>>>
                                      : WithOther<Q, OptionValueOf<TOpts>>
                                    : Q extends SingleChoiceQuestion<string, infer TOpts>
                                      ? WithOther<Q, OptionValueOf<TOpts>>
                                      : Q extends DropdownQuestion<string, infer TOpts>
                                        ? WithOther<Q, OptionValueOf<TOpts>>
                                        : Q extends MultiChoiceQuestion<string, infer TOpts>
                                          ? Array<WithOther<Q, OptionValueOf<TOpts>>>
                                          : never;

/**
 * `required: true` on a question means its answer is guaranteed present at
 * submit time. Anything else may be `undefined`. `single_choice` defaults to
 * required:true per brief §5; `dropdown`, `yes_no`, and `legal` follow the
 * same default.
 */
type DefaultRequiredQuestion =
  | SingleChoiceQuestion
  | DropdownQuestion
  | YesNoQuestion
  | LegalQuestion;

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
    : never]: IsRequired<K> extends true ? AnswerValueOf<K> : AnswerValueOf<K> | undefined;
};
