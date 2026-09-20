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
    questions: z.array(generatedQuestionSchema).min(3).max(12),
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
    });
  });

export type GeneratedForm = z.infer<typeof generatedFormSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

export const GENERATE_SYSTEM_PROMPT = `You author first-draft conversational forms for Slate (Palm Street Web).

Return one form object that matches the schema exactly. Each question is a flat object: fill unused strings with "", unused numbers with 0, unused option arrays with [].

Chrome (never inside questions[]):
- welcome — first screen. subtitle + cta required (cta often "Start").
- thanks — last screen. subtitle + cta required (cta often "Submit another").

questions[].type must be one of:
statement, short_text, long_text, email, phone, url, number, date, file_upload,
single_choice, multi_choice, dropdown, picture_choice, ranking, matrix,
yes_no, legal, scale, nps, review.

When to use each:
- statement — info-only. Use body + cta.
- short_text — one line. placeholder required.
- long_text — paragraph. placeholder required.
- email — email address. placeholder like "you@studio.com".
- phone — phone. placeholder like "(555) 123-4567". defaultCountry usually "US".
- url — website / portfolio. placeholder like "https://studio.com".
- number — guests, budget, years. Set min, max, step (step usually 1).
- date — calendar. format "MM/DD/YYYY" unless day-first.
- file_upload — resume/photos. accept e.g. "image/*,.pdf", maxSizeMb (8), multiple, maxFiles.
- single_choice — pick one. 2–8 options (label + value). src/alt "".
- multi_choice — pick many. options + min + max.
- dropdown — long lists (7+). placeholder + options.
- picture_choice — only if the user wants images. Each option needs https src + alt. You may use https://picsum.photos/seed/<value>/400/300.
- ranking — order priorities. options.
- matrix — rows + columns (label + value). 2–8 each.
- yes_no — binary. yesLabel / noLabel (Yes / No).
- legal — consent. body + acceptLabel + declineLabel.
- scale — min < max, minLabel + maxLabel.
- nps — 0–10 recommend. minLabel / maxLabel (Not at all likely / Extremely likely).
- review — at most one, last in questions[] if used. subtitle + cta.

Rules:
- 3–8 questions unless the user asks otherwise (hard cap 12).
- Never put welcome or thanks inside questions[].
- Pick the type that matches the data (email, date, url, nps, yes_no, file_upload).
- ids are unique snake_case starting with a letter.
- Placeholders are specific, never "Type here".
- Required: identity / RSVP / contact / legal usually true; comments false.
- Theme: editorial for personal/events; swiss for business/SaaS.
- title is the form name. description is one sentence.
- Option values are stable ids (chicken, vegetarian).
- Write in the user's language. Sound like a thoughtful host.`;
