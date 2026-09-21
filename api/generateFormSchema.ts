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
  options: z.array(optionSchema),
  rows: z.array(optionSchema),
  columns: z.array(optionSchema),
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
      ]);
      if (needsOptions.has(q.type) && q.options.filter((o) => o.label && o.value).length < 2) {
        ctx.addIssue({ code: 'custom', message: `${q.type} needs at least 2 options`, path: [...path, 'options'] });
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
          ctx.addIssue({ code: 'custom', message: 'matrix needs 2+ rows', path: [...path, 'rows'] });
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
        ctx.addIssue({ code: 'custom', message: 'scale min must be less than max', path: [...path] });
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
