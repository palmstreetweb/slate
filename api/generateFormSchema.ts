/**
 * Zod model for Build with AI drafts (ADR-039).
 * Flat question objects (not a 20-way union) so Anthropic structured output
 * can compile the grammar. Every editor-addable type is still allowed.
 */

import { z } from 'zod';

export const GENERATED_QUESTION_TYPES = [
  'statement',
  'short_text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'date',
  'file_upload',
  'single_choice',
  'multi_choice',
  'dropdown',
  'picture_choice',
  'ranking',
  'matrix',
  'yes_no',
  'legal',
  'scale',
  'nps',
  'contact_info',
  'address',
  'signature',
  'image_pin',
  'voice_note',
  'location',
  'photo_checklist',
  'availability',
  'review',
] as const;

export type GeneratedQuestionType = (typeof GENERATED_QUESTION_TYPES)[number];

/** AI drafts only. The engine has no question limit. 24 fits a full worksheet. */
export const GENERATED_QUESTION_MAX = 24;

const id = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'ids must be snake_case starting with a letter');

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
  src: z.string(),
  alt: z.string(),
});

/** Choice options can carry prices and package-card details (ADR-064). 0 / "" / [] = none. */
const pricedOptionSchema = optionSchema.extend({
  price: z.number(),
  priceMax: z.number(),
  features: z.array(z.string()),
  badge: z.string(),
});

export const generatedQuestionSchema = z.object({
  id,
  type: z.enum(GENERATED_QUESTION_TYPES),
  title: z.string().min(1),
  placeholder: z.string(),
  body: z.string(),
  cta: z.string(),
  subtitle: z.string(),
  required: z.boolean(),
  defaultCountry: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  format: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', '']),
  accept: z.string(),
  maxSizeMb: z.number(),
  multiple: z.boolean(),
  maxFiles: z.number(),
  yesLabel: z.string(),
  noLabel: z.string(),
  acceptLabel: z.string(),
  declineLabel: z.string(),
  minLabel: z.string(),
  maxLabel: z.string(),
  options: z.array(pricedOptionSchema),
  rows: z.array(optionSchema),
  columns: z.array(optionSchema),
  /** Choice questions: add "Other" with a text box (ADR-063). */
  allowOther: z.boolean(),
  /**
   * scale: numbers | stars | emoji | slider. number: stepper (ADR-063).
   * single_choice: cards (package cards, ADR-064). '' = default.
   */
  display: z.enum(['', 'numbers', 'stars', 'emoji', 'slider', 'stepper', 'cards', 'swipe']),
  /** number: price per unit for the instant estimate (ADR-064). 0 = none. */
  unitPrice: z.number(),
  /** address: ZIP codes or prefixes served, only when the user lists them (ADR-064). */
  serviceArea: z.array(z.string()),
  /** number: shown after / before the value, e.g. "sq ft", "$" (display only). */
  unit: z.string(),
  prefix: z.string(),
  /** date: also ask for a time of day / ask for a start and end. */
  includeTime: z.boolean(),
  range: z.boolean(),
  /** voice_note: offer "Type instead" (ADR-065). signature: type your name instead. */
  allowTyped: z.boolean(),
  /** location: how far the business serves, in radiusUnit; 0 = no radius (ADR-065). */
  radius: z.number(),
  radiusUnit: z.enum(['', 'mi', 'km']),
  /** availability: weekday columns, first slot start and last slot end ("08:00", "18:00"). */
  days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])),
  startTime: z.string(),
  endTime: z.string(),
  /** Earlier question id. Empty = always visible. */
  showIfField: z.string(),
  /** Stored answer to match (`yes`, `chicken`, option value — not the label). */
  showIfEquals: z.string(),
});

export const generatedFormSchema = z
  .object({
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(280),
    theme: z.enum(['editorial', 'swiss']),
    welcome: z.object({
      title: z.string().min(1),
      subtitle: z.string(),
      cta: z.string(),
    }),
    questions: z.array(generatedQuestionSchema).min(3).max(GENERATED_QUESTION_MAX),
    thanks: z.object({
      title: z.string().min(1),
      subtitle: z.string(),
      cta: z.string(),
    }),
    /** Instant estimate on the thanks screen (ADR-064); show false = none. */
    estimate: z.object({
      show: z.boolean(),
      currency: z.string(),
      base: z.number(),
      disclaimer: z.string(),
    }),
  })
  .superRefine((val, ctx) => {
    const ids = val.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'question ids must be unique', path: ['questions'] });
    }
    val.questions.forEach((q, i) => {
      const path = ['questions', i] as const;
      const needsOptions = new Set([
        'single_choice',
        'multi_choice',
        'dropdown',
        'picture_choice',
        'ranking',
        'photo_checklist',
      ]);
      if (needsOptions.has(q.type) && q.options.filter((o) => o.label && o.value).length < 2) {
        ctx.addIssue({
          code: 'custom',
          message: `${q.type} needs at least 2 options`,
          path: [...path, 'options'],
        });
      }
      if (q.type === 'picture_choice') {
        const pics = q.options.filter((o) => o.label && o.value && o.src);
        if (pics.length < 2) {
          ctx.addIssue({
            code: 'custom',
            message: 'picture_choice options need https src',
            path: [...path, 'options'],
          });
        }
      }
      if (q.type === 'matrix') {
        if (q.rows.filter((o) => o.label && o.value).length < 2) {
          ctx.addIssue({
            code: 'custom',
            message: 'matrix needs 2+ rows',
            path: [...path, 'rows'],
          });
        }
        if (q.columns.filter((o) => o.label && o.value).length < 2) {
          ctx.addIssue({
            code: 'custom',
            message: 'matrix needs 2+ columns',
            path: [...path, 'columns'],
          });
        }
      }
      if (q.type === 'scale' && q.min >= q.max) {
        ctx.addIssue({
          code: 'custom',
          message: 'scale min must be less than max',
          path: [...path],
        });
      }
      const showField = q.showIfField.trim();
      const showEquals = q.showIfEquals.trim();
      if (showField || showEquals) {
        if (!showField || !showEquals) {
          ctx.addIssue({
            code: 'custom',
            message: 'showIf needs both field and equals',
            path: [...path, 'showIfField'],
          });
        } else if (showField === q.id) {
          ctx.addIssue({
            code: 'custom',
            message: 'showIf cannot reference itself',
            path: [...path, 'showIfField'],
          });
        } else if (!ids.includes(showField)) {
          ctx.addIssue({
            code: 'custom',
            message: `showIf field "${showField}" is not a question id`,
            path: [...path, 'showIfField'],
          });
        }
      }
    });
  });

/**
 * A draft from before Wave B (ADR-064) lacks the price, card and estimate
 * fields, and one from before Wave C (ADR-065) the typing, radius and grid
 * fields; a revise request can still carry one (a tab open across a deploy).
 * Fill the blanks the model would have written, so it still validates.
 */
export function withDraftDefaults(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const form = { ...(raw as Record<string, unknown>) };
  if (form.estimate === undefined) {
    form.estimate = { show: false, currency: 'USD', base: 0, disclaimer: '' };
  }
  if (Array.isArray(form.questions)) {
    form.questions = form.questions.map((q: unknown) => {
      if (q === null || typeof q !== 'object' || Array.isArray(q)) return q;
      const next = { ...(q as Record<string, unknown>) };
      if (next.unitPrice === undefined) next.unitPrice = 0;
      if (next.serviceArea === undefined) next.serviceArea = [];
      // Wave C (ADR-065)
      if (next.allowTyped === undefined) next.allowTyped = true;
      if (next.radius === undefined) next.radius = 0;
      if (next.radiusUnit === undefined) next.radiusUnit = '';
      if (next.days === undefined) next.days = [];
      if (next.startTime === undefined) next.startTime = '';
      if (next.endTime === undefined) next.endTime = '';
      if (Array.isArray(next.options)) {
        next.options = next.options.map((o: unknown) =>
          o && typeof o === 'object' && !Array.isArray(o)
            ? { price: 0, priceMax: 0, features: [], badge: '', ...(o as Record<string, unknown>) }
            : o,
        );
      }
      return next;
    });
  }
  return form;
}

export type GeneratedForm = z.infer<typeof generatedFormSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

export const GENERATE_SYSTEM_PROMPT = `You author first-draft conversational forms for Slate (Palm Street Web).

Return one form object that matches the schema exactly. Each question is a flat object: fill unused strings with "", unused numbers with 0, unused option arrays with [].

Chrome (never inside questions[]):
- welcome — ALWAYS the first screen the respondent sees. A host greeting, not a question.
  Title is a welcome ("Welcome.", "You're invited.", "Glad you're here.") — never ends with "?".
  Never put "How was your visit?" or any other question on welcome. Those belong in questions[].
  subtitle is why we're here; cta is usually "Start".
- thanks — ALWAYS the last screen. A goodbye ("Thank you.", "You're all set.") — never a question.
  subtitle + cta required (cta often "Submit another").

Default types (use these unless the user asks otherwise):
short_text, long_text, email, phone, date, single_choice, yes_no, number.

Use only when the prompt clearly needs them:
- url — portfolio / website
- file_upload — resume / photos
- dropdown — 7+ options
- multi_choice — pick many
- legal — consent
- scale — 1–5 / 1–10 rating (not NPS)
- nps — "how likely to recommend"
- ranking / matrix — only if the user asks to rank or grade several items
- picture_choice — only if the user wants images. Each option needs https src + alt. You may use https://picsum.photos/seed/<value>/400/300
- statement / review — sparingly

Do not add ranking, matrix, NPS, or picture_choice to "look complete."

Options (leave false / "" unless they clearly help):
- allowOther: true on single_choice, multi_choice, dropdown or picture_choice when people may not fit the list ("How did you hear about us?", "Which service?"). Adds "Other" with a text box. Never on yes_no or legal.
- display on scale: "stars" to rate a visit or service, "emoji" (faces) for how someone feels, "slider" for a wide range like 0–10. Otherwise "".
- display "stepper" on number for small counts (rooms, windows, people, pets): set min and max; unit ("windows", "sq ft") and prefix ("$") are display only.
- date: includeTime for appointments or pickups at a time of day; range for spans (a stay, event dates, "available from / to").

Service-business types (use when they fit):
- contact_info — name, email and phone on ONE screen. For quotes, bookings and leads, prefer it over separate name / email / phone questions. Title like "How can we reach you?"
- address — a service or property address (street, unit, city, state, ZIP). serviceArea only when the user lists the ZIP codes they serve (e.g. ["93101","93103"], or a prefix "931"); otherwise [].
- signature — only when the user asks for a signature, authorization or agreement.

On-site capture (use only when they clearly fit; never "to look complete"):
- photo_checklist — the shots a crew needs before quoting ("Front of house", "Roof close-up", "Electrical panel"): each option is one shot (label + value). Opens the phone camera.
- image_pin — "show us where": the respondent taps the owner's photo to mark spots. max = most pins (1–10, usually 3). The owner adds the photo afterwards; do not invent one.
- voice_note — "describe it in your own words" when talking is easier than typing. max = longest recording in seconds (default 60). allowTyped true unless the user wants audio only. body is what to talk about.
- location — "use my location" to check the service area. radius + radiusUnit ("mi" / "km") only when the user gives a distance ("within 25 miles"); the owner sets the business location afterwards. Never invent coordinates.
- availability — a week grid to paint free times. days (e.g. ["mon","tue","wed","thu","fri"]), startTime / endTime as "HH:MM" 24-hour, step = slot minutes (15, 30, 60 or 120; default 60).
- display "swipe": on picture_choice with multiple true, a card stack to like / pass ("Which styles do you like?"); on yes_no, one swipe card ("this or that"). Otherwise "".

Prices and the instant estimate (never invent prices — only use prices the user gave):
- price on a choice option = its price; priceMax for a range ("$8,000–12,000" → price 8000, priceMax 12000). 0 = no price.
- unitPrice on a number = price per unit (windows × $450). 0 = none.
- display "cards" on single_choice for packages or tiers (Basic / Standard / Premium): give each option up to 6 short features and badge "Most popular" on at most one.
- estimate.show true when the form has prices and the user wants a quote or estimate shown; currency is the ISO code ("USD"); base is a flat fee added to every quote (0 = none); disclaimer is one short line ("Final price after inspection"). Otherwise show false, currency "USD", base 0, disclaimer "".

Branching (showIfField / showIfEquals):
- Empty strings = always visible.
- For follow-ups (plus-one, meal, "if yes, tell us more"), set showIfField to an earlier question id and showIfEquals to that question's stored value — not the label.
- yes_no stores "yes" or "no". legal stores "accept" or "decline". choice stores the option value (chicken, vegetarian).
- Never point showIfField at itself.

When revising a draft: keep ids stable for questions that remain. Change copy, drop extras, or add fields as asked.

Rules:
- A short prompt stays 3–8 questions.
- A document, or a request to keep everything, uses one question per blank, choice, or numbered pair. Section notes become statements. Do not merge or drop lines to stay short. Hard cap ${GENERATED_QUESTION_MAX}.
- Never put welcome or thanks inside questions[].
- Never use a question as the welcome or thanks title.
- Pick the type that matches the data (email, date, phone, yes_no).
- ids are unique snake_case starting with a letter.
- Placeholders are specific, never "Type here".
- Required: identity / RSVP / contact / legal usually true; comments false.
- Theme: editorial for personal/events; swiss for business/SaaS.
- title is the form name. description is one sentence.
- Option values are stable ids (chicken, vegetarian).
- Write in the user's language. Sound like a thoughtful host.`;
