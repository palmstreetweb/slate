import { describe, expect, it } from 'vitest';
import {
  GENERATED_QUESTION_MAX,
  GENERATE_SYSTEM_PROMPT,
  generatedFormSchema,
} from '../api/_lib/generateFormSchema.js';
import { blankGeneratedQuestion, mapGeneratedForm } from '../api/_lib/mapGeneratedForm.js';
import { resetRateLimit, takeRateLimit } from '../api/_lib/rateLimit.js';
import { buildGenerateUserPrompt } from '../api/_lib/runGenerate.js';
import { checkSchema } from '../src/logic/schemaCheck.js';
import { validate } from '../src/logic/validation.js';
import { AI_GOLDEN_PROMPTS } from '../examples/_admin/ai/goldenPrompts.js';

// The model fills every option field; no price / card details = 0, [] and '' (ADR-064).
const opt = (label: string, value: string) => ({
  label,
  value,
  src: '',
  alt: '',
  price: 0,
  priceMax: 0,
  features: [] as string[],
  badge: '',
  capacity: 0,
  date: '',
  start: '',
  end: '',
});

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
      showIfField: 'coming',
      showIfEquals: 'yes',
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
  estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
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
    const meal = schema.questions.find((q) => q.id === 'meal');
    expect(meal && 'visibleIf' in meal ? meal.visibleIf : undefined).toEqual({
      field: 'coming',
      op: 'equals',
      value: 'yes',
    });
  });

  it('rejects a showIf that points at a missing question', () => {
    const bad = {
      ...validDraft,
      questions: validDraft.questions.map((q) =>
        q.id === 'meal' ? { ...q, showIfField: 'not_a_question', showIfEquals: 'yes' } : q,
      ),
    };
    expect(generatedFormSchema.safeParse(bad).success).toBe(false);
  });

  it('builds a revise prompt from the previous draft', () => {
    const parsed = generatedFormSchema.parse(validDraft);
    const user = buildGenerateUserPrompt({
      prompt: 'Wedding RSVP',
      previous: parsed,
      instruction: 'Make it shorter',
    });
    expect(user).toContain('Original request:');
    expect(user).toContain('Make it shorter');
    expect(user).toContain('"id":"coming"');
  });

  it('turns a question pinned on welcome into a real greeting plus an opener', () => {
    const draft = {
      ...validDraft,
      title: 'Restaurant Service Feedback',
      welcome: {
        title: 'How was your visit?',
        subtitle: 'Your feedback helps us serve you better.',
        cta: 'Start',
      },
    };
    const parsed = generatedFormSchema.parse(draft);
    const { schema } = mapGeneratedForm(parsed);
    expect(schema.questions[0]).toMatchObject({ type: 'welcome', title: 'Welcome.' });
    expect(
      schema.questions[0] && 'subtitle' in schema.questions[0] ? schema.questions[0].subtitle : '',
    ).toBe('Your feedback helps us serve you better.');
    const opener = schema.questions[1];
    expect(opener).toMatchObject({ type: 'long_text', title: 'How was your visit?' });
    expect(checkSchema(schema.questions)).toEqual([]);
  });

  it('keeps a real welcome greeting', () => {
    const parsed = generatedFormSchema.parse(validDraft);
    const { schema } = mapGeneratedForm(parsed);
    expect(schema.questions[0]).toMatchObject({ type: 'welcome', title: 'You’re invited.' });
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

  it('accepts a worksheet up to the AI cap and rejects one past it', () => {
    const pad = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        blankGeneratedQuestion({
          id: `extra_${i + 1}`,
          type: 'short_text',
          title: `Extra ${i + 1}?`,
          placeholder: 'A note',
          required: false,
        }),
      );
    const atCap = {
      ...validDraft,
      questions: [
        ...validDraft.questions,
        ...pad(GENERATED_QUESTION_MAX - validDraft.questions.length),
      ],
    };
    expect(atCap.questions).toHaveLength(GENERATED_QUESTION_MAX);
    expect(generatedFormSchema.safeParse(atCap).success).toBe(true);
    expect(
      generatedFormSchema.safeParse({
        ...validDraft,
        questions: [...atCap.questions, ...pad(1).map((q) => ({ ...q, id: 'one_past' }))],
      }).success,
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

describe('Build with AI — Wave A options (ADR-063)', () => {
  it('maps Other, scale and number styles, units, and date time / range', () => {
    const draft = {
      ...validDraft,
      questions: [
        blankGeneratedQuestion({
          id: 'heard',
          type: 'single_choice',
          title: 'How did you hear about us?',
          options: [opt('Flyer', 'flyer'), opt('Google', 'google')],
          allowOther: true,
        }),
        blankGeneratedQuestion({
          id: 'rate',
          type: 'scale',
          title: 'Rate the crew',
          min: 1,
          max: 5,
          display: 'stars',
        }),
        blankGeneratedQuestion({
          id: 'windows',
          type: 'number',
          title: 'How many windows?',
          min: 1,
          max: 40,
          display: 'stepper',
          unit: 'windows',
        }),
        blankGeneratedQuestion({
          id: 'visit',
          type: 'date',
          title: 'When can we come?',
          includeTime: true,
        }),
        blankGeneratedQuestion({ id: 'stay', type: 'date', title: 'Dates?', range: true }),
      ],
    };
    const { schema } = mapGeneratedForm(generatedFormSchema.parse(draft));
    const byId = Object.fromEntries(schema.questions.map((q) => [q.id, q])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(byId.heard!.allowOther).toBe(true);
    expect(byId.rate!.display).toBe('stars');
    expect(byId.windows).toMatchObject({ display: 'stepper', unit: 'windows', min: 1, max: 40 });
    expect(byId.windows).not.toHaveProperty('prefix');
    expect(byId.visit!.includeTime).toBe(true);
    expect(byId.visit).not.toHaveProperty('range');
    expect(byId.stay!.range).toBe(true);
    expect(checkSchema(schema.questions)).toEqual([]);
  });

  it('leaves every option off when the model leaves them blank', () => {
    const { schema } = mapGeneratedForm(generatedFormSchema.parse(validDraft));
    for (const q of schema.questions) {
      for (const key of ['allowOther', 'display', 'unit', 'prefix', 'includeTime', 'range']) {
        expect(q).not.toHaveProperty(key);
      }
    }
  });
});

describe('Build with AI — bounds a draft can’t trap people with (F15, decision 1)', () => {
  const draftWith = (questions: ReturnType<typeof blankGeneratedQuestion>[]) =>
    mapGeneratedForm(generatedFormSchema.parse({ ...validDraft, questions })).schema;
  const byId = (schema: ReturnType<typeof draftWith>) =>
    Object.fromEntries(schema.questions.map((q) => [q.id, q])) as Record<
      string,
      Record<string, unknown>
    >;
  const filler = [
    blankGeneratedQuestion({ id: 'f1', type: 'short_text', title: 'F1' }),
    blankGeneratedQuestion({ id: 'f2', type: 'short_text', title: 'F2' }),
  ];

  it('a number left at the blank 0 / 0 has no bounds, so any budget is fine', () => {
    const schema = draftWith([
      blankGeneratedQuestion({ id: 'budget', type: 'number', title: 'What is your budget?' }),
      ...filler,
    ]);
    const budget = schema.questions.find((q) => q.id === 'budget')!;
    expect(budget).not.toHaveProperty('min');
    expect(budget).not.toHaveProperty('max');
    expect(budget).toMatchObject({ step: 1 });
    expect(validate(budget, 500)).toBeNull();
    expect(checkSchema(schema.questions)).toEqual([]);
  });

  it('a max at or below the min is dropped; a broken step becomes 1', () => {
    const by = byId(
      draftWith([
        blankGeneratedQuestion({ id: 'a', type: 'number', title: 'A', min: 10, max: 5, step: 0 }),
        blankGeneratedQuestion({ id: 'b', type: 'number', title: 'B', min: 2, max: 0, step: -3 }),
        blankGeneratedQuestion({ id: 'c', type: 'number', title: 'C', min: 1, max: 40, step: 2 }),
      ]),
    );
    expect(by.a).toMatchObject({ min: 10, step: 1 });
    expect(by.a).not.toHaveProperty('max');
    expect(by.b).toMatchObject({ min: 2, step: 1 });
    expect(by.b).not.toHaveProperty('max');
    expect(by.c).toMatchObject({ min: 1, max: 40, step: 2 });
  });

  it('multi-choice picks: whole, reachable, and "required" means at least one', () => {
    const three = [opt('One', 'one'), opt('Two', 'two'), opt('Three', 'three')];
    const by = byId(
      draftWith([
        blankGeneratedQuestion({
          id: 'blank',
          type: 'multi_choice',
          title: 'Blank',
          options: three,
        }),
        blankGeneratedQuestion({
          id: 'needed',
          type: 'multi_choice',
          title: 'Needed',
          options: three,
          required: true,
        }),
        blankGeneratedQuestion({
          id: 'toomany',
          type: 'multi_choice',
          title: 'Too many',
          options: three,
          min: 5,
          max: 2,
        }),
        blankGeneratedQuestion({
          id: 'other',
          type: 'multi_choice',
          title: 'With Other',
          options: three,
          allowOther: true,
          min: 4,
          max: 3.4,
        }),
      ]),
    );
    expect(by.blank).not.toHaveProperty('min');
    expect(by.blank).not.toHaveProperty('max');
    expect(by.needed).toMatchObject({ min: 1 });
    // 5 of 3 can't happen: at most every choice; a max under the min goes.
    expect(by.toomany).toMatchObject({ min: 3 });
    expect(by.toomany).not.toHaveProperty('max');
    // Other counts as a choice; 3.4 rounds to 3, under the minimum of 4.
    expect(by.other).toMatchObject({ min: 4 });
    expect(by.other).not.toHaveProperty('max');
    expect(validate(by.needed as never, [])).toMatchObject({ code: 'min_selections' });
  });

  it('picture picks only apply with multi-select; files never get a size or count of 0', () => {
    const pics = [
      { ...opt('A', 'a'), src: 'https://example.com/a.jpg' },
      { ...opt('B', 'b'), src: 'https://example.com/b.jpg' },
    ];
    const by = byId(
      draftWith([
        blankGeneratedQuestion({
          id: 'one',
          type: 'picture_choice',
          title: 'One',
          options: pics,
          min: 2,
          max: 0,
        }),
        blankGeneratedQuestion({
          id: 'many',
          type: 'picture_choice',
          title: 'Many',
          options: pics,
          multiple: true,
          required: true,
          max: 0,
        }),
        blankGeneratedQuestion({
          id: 'files',
          type: 'file_upload',
          title: 'Files',
          maxSizeMb: -5,
          maxFiles: 0,
        }),
      ]),
    );
    expect(by.one).not.toHaveProperty('min');
    expect(by.one).not.toHaveProperty('max');
    expect(by.many).toMatchObject({ multiple: true, min: 1 });
    expect(by.many).not.toHaveProperty('max');
    expect(by.files!.maxSizeMb).toBeUndefined();
    expect(by.files!.maxFiles).toBeUndefined();
  });

  it('the prompt tells the model 0 means no limit', () => {
    expect(GENERATE_SYSTEM_PROMPT).toMatch(/0 = no limit/);
  });
});
