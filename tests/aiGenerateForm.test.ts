import { describe, expect, it } from 'vitest';
import { generatedFormSchema } from '../api/generateFormSchema.js';
import { blankGeneratedQuestion, mapGeneratedForm } from '../api/mapGeneratedForm.js';
import { resetRateLimit, takeRateLimit } from '../api/rateLimit.js';
import { checkSchema } from '../src/logic/schemaCheck.js';
import { AI_GOLDEN_PROMPTS } from '../examples/_admin/ai/goldenPrompts.js';

const opt = (label: string, value: string) => ({ label, value, src: '', alt: '' });

const validDraft = {
  title: 'Wedding RSVP',
  description: 'Collect attendance, meal, and a plus-one.',
  theme: 'editorial' as const,
  welcome: { title: 'You’re invited.', subtitle: 'Tell us if you can make it.', cta: 'Start' },
  questions: [
    blankGeneratedQuestion({
      id: 'name',
      type: 'short_text',
      title: 'Your name?',
      placeholder: 'Jordan Lee',
      required: true,
    }),
    blankGeneratedQuestion({
      id: 'coming',
      type: 'single_choice',
      title: 'Will you be there?',
      required: true,
      options: [opt('Joyfully accept', 'yes'), opt('Regretfully decline', 'no')],
    }),
    blankGeneratedQuestion({
      id: 'meal',
      type: 'single_choice',
      title: 'Meal preference',
      required: true,
      options: [opt('Chicken', 'chicken'), opt('Fish', 'fish'), opt('Vegetarian', 'vegetarian')],
    }),
    blankGeneratedQuestion({
      id: 'plus_one',
      type: 'short_text',
      title: 'Plus-one’s name, if any',
      placeholder: 'Alex Rivera',
      required: false,
    }),
    blankGeneratedQuestion({
      id: 'notes',
      type: 'long_text',
      title: 'Anything we should know?',
      placeholder: 'Allergies, songs, accessibility…',
      required: false,
    }),
  ],
  thanks: { title: 'Thank you.', subtitle: 'We can’t wait.', cta: 'Done' },
};

describe('Build with AI schema', () => {
  it('accepts a draft and maps to a clean engine schema', () => {
    const parsed = generatedFormSchema.parse(validDraft);
    const { name, schema } = mapGeneratedForm(parsed);
    expect(name).toBe('Wedding RSVP');
    expect(schema.theme).toBe('editorial');
    expect(schema.themeMode).toBe('toggle');
    expect(schema.questions[0]?.type).toBe('welcome');
    expect(schema.questions[schema.questions.length - 1]?.type).toBe('thanks');
    expect(checkSchema(schema.questions)).toEqual([]);
  });

  it('rejects invented question types', () => {
    const bad = {
      ...validDraft,
      questions: [
        ...validDraft.questions.slice(0, 3),
        blankGeneratedQuestion({ id: 'mystery', type: 'wizard' as never, title: 'Nope' }),
      ],
    };
    expect(generatedFormSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects fewer than 3 questions', () => {
    expect(
      generatedFormSchema.safeParse({ ...validDraft, questions: validDraft.questions.slice(0, 2) })
        .success,
    ).toBe(false);
  });

  it('accepts later editor types and maps them', () => {
    const draft = {
      ...validDraft,
      questions: [
        blankGeneratedQuestion({
          id: 'site',
          type: 'url',
          title: 'Portfolio?',
          placeholder: 'https://studio.com',
          required: true,
        }),
        blankGeneratedQuestion({
          id: 'day',
          type: 'date',
          title: 'Event date',
          required: true,
          format: 'MM/DD/YYYY',
        }),
        blankGeneratedQuestion({
          id: 'resume',
          type: 'file_upload',
          title: 'Resume',
          required: true,
          accept: '.pdf',
          maxSizeMb: 8,
          multiple: false,
          maxFiles: 1,
        }),
        blankGeneratedQuestion({
          id: 'coming',
          type: 'yes_no',
          title: 'Will you join?',
          yesLabel: 'Yes',
          noLabel: 'No',
          required: true,
        }),
        blankGeneratedQuestion({
          id: 'score',
          type: 'nps',
          title: 'How likely are you to recommend us?',
          minLabel: 'Not at all likely',
          maxLabel: 'Extremely likely',
          required: true,
        }),
      ],
    };
    const parsed = generatedFormSchema.parse(draft);
    const { schema } = mapGeneratedForm(parsed);
    const types = schema.questions.map((q) => q.type);
    expect(types).toContain('url');
    expect(types).toContain('date');
    expect(types).toContain('file_upload');
    expect(types).toContain('yes_no');
    expect(types).toContain('nps');
    expect(checkSchema(schema.questions)).toEqual([]);
  });

  it('lists 15 golden prompts', () => {
    expect(AI_GOLDEN_PROMPTS).toHaveLength(15);
    const kinds = new Set(AI_GOLDEN_PROMPTS.map((p) => p.kind));
    expect(kinds.has('RSVP')).toBe(true);
    expect(kinds.has('lead capture')).toBe(true);
    expect(kinds.has('job application')).toBe(true);
    expect(kinds.has('feedback survey')).toBe(true);
    expect(kinds.has('event registration')).toBe(true);
  });
});

describe('generate rate limit', () => {
  it('allows 10 hits per IP per minute and blocks the 11th', () => {
    resetRateLimit();
    for (let i = 0; i < 10; i += 1) expect(takeRateLimit('1.1.1.1', 1_000 + i)).toBe(true);
    expect(takeRateLimit('1.1.1.1', 1_020)).toBe(false);
    expect(takeRateLimit('9.9.9.9', 1_020)).toBe(true);
  });
});
