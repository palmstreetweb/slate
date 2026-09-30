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
  /**
   * Price for the instant estimate (ADR-064): the exact price, or the low end
   * of a range when `priceMax` is set. In the form's currency (`schema.estimate`).
   */
  price?: number;
  /** High end of a price range. Omit for a single price. */
  priceMax?: number;
  /** Package cards (`display: 'cards'`): short feature lines under the price (ADR-064). */
  features?: ReadonlyArray<string>;
  /** Package cards: a small badge on the card, e.g. "Most popular". */
  badge?: string;
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
  /**
   * Reveal the instant estimate on this ending (ADR-064), from the prices on
   * the answers and `schema.estimate`. Shown once the response is received.
   */
  showEstimate?: boolean;
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
    /**
     * Price per unit for the instant estimate (ADR-064): the answer × this, in
     * the form's currency. With `unitPriceMax`, a low / high range per unit.
     */
    unitPrice?: number;
    unitPriceMax?: number;
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

/** How a `single_choice` question is drawn (ADR-064). The answer is the same option value. */
export type ChoiceDisplay = 'list' | 'cards';

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
    /**
     * 'list' (default) is one row per option; 'cards' draws package cards with
     * the option's price, features and badge (ADR-064).
     */
    display?: ChoiceDisplay;
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

/** How a `yes_no` question is drawn (ADR-065). The answer is the same `'yes' | 'no'`. */
export type YesNoDisplay = 'buttons' | 'swipe';

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
    /**
     * 'buttons' (default) is two choices; 'swipe' is one card — swipe right
     * (or →, or ✓) for yes, left for no (ADR-065).
     */
    display?: YesNoDisplay;
  };

/** How a `picture_choice` question is drawn (ADR-065). */
export type PictureChoiceDisplay = 'grid' | 'swipe';

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
    /**
     * 'grid' (default), or 'swipe' — a card stack: swipe right to like, left
     * to pass (ADR-065). Swipe needs `multiple: true`; the answer is the same
     * list of picked (liked) option values, so switching styles keeps answers.
     */
    display?: PictureChoiceDisplay;
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

/* ---------- contact, address, signature (ADR-064) ---------- */

/** Whether one part of a contact block is asked, and whether it must be filled. */
export type ContactFieldMode = 'off' | 'optional' | 'required';

/** The parts of a contact block. */
export type ContactField = 'name' | 'email' | 'phone';

/**
 * Name, email and phone on one screen, as one question (ADR-064). Stored as
 * `{ name?, email?, phone? }` — only the parts that were filled. Phone is
 * stored as E.164 when it parses.
 */
export type ContactInfoQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'contact_info';
    title: DynamicTitle;
    /**
     * Which parts show and which are required. Unset parts use the default:
     * name and email required, phone optional.
     */
    fields?: Partial<Record<ContactField, ContactFieldMode>>;
    /** ISO 3166-1 alpha-2 code for phone numbers typed without one; default 'US'. */
    defaultCountry?: string;
  };

/** Address layout: US (State, 5-digit ZIP) or international (region, postal code). */
export type AddressFormat = 'us' | 'international';

/**
 * A postal address as one question (ADR-064). Stored as
 * `{ street, line2?, city, region?, postal, country? }` — only filled parts.
 * No lookup service: browser autofill fills it.
 */
export type AddressQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'address';
    title: DynamicTitle;
    required?: boolean;
    /** Show the apartment / unit line; default true. */
    line2?: boolean;
    /** Ask for the country; default false. */
    country?: boolean;
    /** Default 'us'. */
    format?: AddressFormat;
    /**
     * ZIP codes or ZIP prefixes the owner serves ('93101', '931'). When set, a
     * condition can test `IN_AREA_VALUE` / `OUT_OF_AREA_VALUE` on this
     * question — e.g. to route to an "out of area" ending.
     */
    serviceArea?: ReadonlyArray<string>;
  };

/**
 * Sign with a finger or mouse (ADR-064). Stored inside the answer as compact
 * vector strokes, `{ path }` (an SVG path in a 500 × 200 box), or `{ typed }`
 * when the respondent typed their name instead.
 */
export type SignatureQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'signature';
    title: DynamicTitle;
    /** Consent or agreement copy shown above the pad. */
    body?: string;
    required?: boolean;
    /**
     * Offer "Type your name instead" (keyboard and screen-reader users can't
     * draw); default true.
     */
    allowTyped?: boolean;
  };

/* ---------- Wave C: pins, voice, location, photos, availability (ADR-065) ---------- */

/**
 * Pin the spot: the respondent taps the owner's photo (a house, a roof, a
 * car) to drop numbered pins, each with an optional short note. Stored as
 * `{ pins: ['x,y', …], notes?: [...], img? }` with x / y from 0 to 1.
 */
export type ImagePinQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'image_pin';
    title: DynamicTitle;
    /**
     * The photo to mark: an `https:` URL, or a small `data:image/…` the studio
     * compressed from an upload. It travels with the published schema.
     */
    image?: string;
    /** What the photo shows, for screen readers. */
    imageAlt?: string;
    required?: boolean;
    /** Most pins, 1–10; default 3. */
    maxPins?: number;
    /** Ask for a short note on each pin ("leak here"); default true. */
    notes?: boolean;
  };

/**
 * Tap to record a short voice note (MediaRecorder). Uploaded like a file;
 * stored as `{ audio, sec }` (a storage ref and the length in seconds), or
 * `{ typed }` when the respondent typed instead.
 */
export type VoiceNoteQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'voice_note';
    title: DynamicTitle;
    /** What to talk about, shown under the title. */
    body?: string;
    required?: boolean;
    /** Longest recording, 5–300 seconds; default 60. */
    maxSeconds?: number;
    /**
     * Offer "Type instead" (no microphone, mic blocked, or a quiet place);
     * default true.
     */
    allowTyped?: boolean;
  };

/** Units for a service-area radius. */
export type DistanceUnit = 'mi' | 'km';

/**
 * "Use my location" and a service-area radius. Stored as
 * `{ lat, lng, area? }` rounded to 3 decimals (about 100 m), or `{ zip, area? }`
 * / `{ typed }` when location is off. `area` ('in' | 'out') is recomputed by
 * the server from the published center and radius. Conditions test it with
 * `IN_AREA_VALUE` / `OUT_OF_AREA_VALUE`, like an address.
 */
export type LocationQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'location';
    title: DynamicTitle;
    required?: boolean;
    /** The middle of the service area (the shop, a town). Public with the form. */
    center?: { lat: number; lng: number };
    /** How far you serve from `center`. */
    radius?: number;
    /** Default 'mi'. */
    radiusUnit?: DistanceUnit;
    /** The privacy line under the button; a clear default is used when unset. */
    privacyNote?: string;
  };

/**
 * Camera-first photo checklist: one photo per shot the owner lists ("Front of
 * house", "Electrical panel"). Stored as `{ [itemValue]: fileRef }`.
 */
export type PhotoChecklistQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'photo_checklist';
    title: DynamicTitle;
    /** The shots, in order. */
    items: ReadonlyArray<Option>;
    /** Every shot is needed; default true. */
    required?: boolean;
  };

/** Days of the week, as stored in availability answers. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * A week grid the respondent paints with the times they're free (When2meet
 * style). Stored as `{ [day]: 'HH:MM-HH:MM,…' }` — only days with time.
 */
export type AvailabilityQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'availability';
    title: DynamicTitle;
    required?: boolean;
    /** Columns, in order; default Monday to Friday. */
    days?: ReadonlyArray<Weekday>;
    /** First slot starts, 'HH:MM' 24-hour; default '08:00'. */
    startTime?: string;
    /** Last slot ends, 'HH:MM' (up to '24:00'); default '18:00'. */
    endTime?: string;
    /** Slot length in minutes: 15, 30, 60 or 120; default 60. */
    slotMinutes?: number;
  };

/* ---------- Wave D: sign-up slots (ADR-066) ---------- */

/**
 * One sign-up slot: "Sat 10–11am, 8 spots", "Bring drinks, 3 spots". `value`
 * is the stable key stored in answers (keep it when the label changes).
 */
export type SignupSlot = {
  label: string;
  /** Letters, digits, `_` and `-`, up to 64 characters. */
  value: string;
  /** Spots, a whole number from 1 to 1,000. */
  capacity: number;
  /** Optional day, ISO `YYYY-MM-DD`. Slots on the same day are grouped under it. */
  date?: string;
  /** Optional start and end, `HH:MM` (24-hour wall clock, no time zone). */
  start?: string;
  end?: string;
  /** A short line under the label ("Meet at the side gate"). */
  description?: string;
};

/**
 * Sign-up slots with limited spots (ADR-066). Respondents see what's left
 * (`<Form slotsLeft>`) and take one slot, or up to `maxPicks`. The server
 * takes the spot in the same transaction as the response, so a slot never
 * holds more people than its capacity; a slot that fills while someone is
 * answering sends them back here to pick another. Stored as
 * `{ slots: [value, …], wait?: [value, …] }` — `wait` is the slots whose
 * waitlist they joined (only with `waitlist: true`).
 */
export type SignupSlotsQuestion<TId extends string = string> = IdField<TId> &
  Visibility & {
    type: 'signup_slots';
    title: DynamicTitle;
    /** What it's for, shown under the title. */
    body?: string;
    slots: ReadonlyArray<SignupSlot>;
    /** Defaults to true. */
    required?: boolean;
    /** Most slots one person may take (waitlists count), 1–50; default 1. */
    maxPicks?: number;
    /** When a slot is full, offer "Join the waitlist"; default false. */
    waitlist?: boolean;
    /** Show how many spots are left ("3 of 8 left"); default true. Full slots always say so. */
    showRemaining?: boolean;
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
  | ContactInfoQuestion
  | AddressQuestion
  | SignatureQuestion
  | ImagePinQuestion
  | VoiceNoteQuestion
  | LocationQuestion
  | PhotoChecklistQuestion
  | AvailabilityQuestion
  | SignupSlotsQuestion
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
