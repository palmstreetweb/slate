// @vitest-environment node
/**
 * Build with AI's model shape (api/_modelForm.ts). Production failed every
 * request with "The compiled grammar is too large…" once the flat question
 * grew to 46 fields; the model now fills a small shape that expands into the
 * full draft the studio already maps.
 */
import { describe, expect, it } from 'vitest';
import { asSchema } from 'ai';
import {
  GENERATED_QUESTION_TYPES,
  generatedFormSchema,
  type GeneratedQuestionType,
} from '../api/generateFormSchema.js';
import {
  fromModelForm,
  modelFormSchema,
  toModelForm,
  type ModelForm,
  type ModelQuestion,
} from '../api/_modelForm.js';
import { mapGeneratedForm } from '../api/mapGeneratedForm.js';
import { checkSchema } from '../src/logic/schemaCheck.js';

type Json = Record<string, unknown>;

function q(
  partial: Partial<ModelQuestion> & Pick<ModelQuestion, 'id' | 'type' | 'title'>,
): ModelQuestion {
  return {
    text: '',
    required: false,
    min: 0,
    max: 0,
    step: 0,
    options: [],
    labels: [],
    settings: [],
    showIfField: '',
    showIfEquals: '',
    ...partial,
  };
}

const opt = (label: string, value: string, more: string[] = [], price = 0) => ({
  label,
  value,
  price,
  more,
});

function form(questions: ModelQuestion[]): ModelForm {
  return {
    title: 'Driveway sealcoating quote',
    description: 'Tell us about your driveway and we will send a quote.',
    theme: 'swiss',
    welcome: { title: 'Welcome.', subtitle: 'A few quick questions.', cta: 'Start' },
    questions,
    thanks: { title: 'Thank you.', subtitle: 'We’ll be in touch.', cta: 'Submit another' },
    estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
  };
}

/** One plausible model question per type: every type stays generatable. */
const SAMPLES: Record<GeneratedQuestionType, ModelQuestion> = {
  statement: q({
    id: 'intro',
    type: 'statement',
    title: 'Before we start',
    text: 'Two minutes.',
    labels: ['Got it'],
  }),
  short_text: q({
    id: 'name',
    type: 'short_text',
    title: 'Your name?',
    text: 'Jordan Lee',
    required: true,
  }),
  long_text: q({
    id: 'notes',
    type: 'long_text',
    title: 'Anything else?',
    text: 'Gate code, pets…',
  }),
  email: q({
    id: 'email',
    type: 'email',
    title: 'Email?',
    text: 'you@example.com',
    required: true,
  }),
  phone: q({
    id: 'phone',
    type: 'phone',
    title: 'Phone?',
    text: '07700 900123',
    settings: ['country: GB'],
  }),
  url: q({ id: 'site', type: 'url', title: 'Website?', text: 'https://studio.com' }),
  number: q({
    id: 'windows',
    type: 'number',
    title: 'How many windows?',
    min: 1,
    max: 40,
    step: 1,
    settings: ['stepper', 'unit: windows', 'prefix: #', 'price: 450'],
  }),
  date: q({ id: 'visit', type: 'date', title: 'When?', settings: ['time', 'day-first'] }),
  file_upload: q({
    id: 'photos',
    type: 'file_upload',
    title: 'Photos?',
    settings: ['multiple', 'accept: image/*', 'max files: 5', 'max size: 10'],
  }),
  single_choice: q({
    id: 'plan',
    type: 'single_choice',
    title: 'Which package?',
    settings: ['cards', 'other'],
    options: [
      opt('Basic', 'basic', ['Crack fill', 'One coat'], 400),
      opt('Premium', 'premium', ['Two coats', 'Edging', 'badge: Most popular', 'up to 900'], 600),
    ],
  }),
  multi_choice: q({
    id: 'extras',
    type: 'multi_choice',
    title: 'Extras?',
    min: 1,
    max: 2,
    options: [opt('Edging', 'edging'), opt('Stripes', 'stripes'), opt('Repairs', 'repairs')],
  }),
  dropdown: q({
    id: 'state',
    type: 'dropdown',
    title: 'State?',
    text: 'Pick one',
    options: [opt('CA', 'ca'), opt('NV', 'nv')],
  }),
  picture_choice: q({
    id: 'style',
    type: 'picture_choice',
    title: 'Which styles?',
    settings: ['multiple', 'swipe'],
    options: [
      opt('Modern', 'modern', ['https://picsum.photos/seed/modern/400/300']),
      opt('Classic', 'classic', ['https://picsum.photos/seed/classic/400/300']),
    ],
  }),
  ranking: q({
    id: 'rank',
    type: 'ranking',
    title: 'Rank these',
    options: [opt('Price', 'price'), opt('Speed', 'speed')],
  }),
  matrix: q({
    id: 'grid',
    type: 'matrix',
    title: 'Rate each',
    options: [opt('Crew', 'crew'), opt('Cleanup', 'cleanup')],
    labels: ['Poor', 'Good', 'Great'],
  }),
  yes_no: q({
    id: 'coming',
    type: 'yes_no',
    title: 'Coming?',
    labels: ['Count me in', 'Not this time'],
  }),
  legal: q({
    id: 'terms',
    type: 'legal',
    title: 'Terms',
    text: 'You agree…',
    labels: ['I agree', 'No'],
  }),
  scale: q({
    id: 'rate',
    type: 'scale',
    title: 'Rate us',
    min: 1,
    max: 5,
    labels: ['Poor', 'Great'],
    settings: ['stars'],
  }),
  nps: q({ id: 'nps', type: 'nps', title: 'Recommend us?', min: 0, max: 10 }),
  contact_info: q({ id: 'contact', type: 'contact_info', title: 'How can we reach you?' }),
  address: q({ id: 'where', type: 'address', title: 'Property address', labels: ['93101', '931'] }),
  signature: q({
    id: 'sign',
    type: 'signature',
    title: 'Sign here',
    text: 'I authorize the work.',
    settings: ['typing-off'],
  }),
  image_pin: q({ id: 'pins', type: 'image_pin', title: 'Show us where', max: 3 }),
  voice_note: q({
    id: 'voice',
    type: 'voice_note',
    title: 'Describe it',
    text: 'Size and cracks',
    max: 90,
  }),
  location: q({ id: 'loc', type: 'location', title: 'Where are you?', max: 25, settings: ['km'] }),
  photo_checklist: q({
    id: 'shots',
    type: 'photo_checklist',
    title: 'Photos we need',
    options: [opt('Front', 'front'), opt('Cracks', 'cracks')],
  }),
  availability: q({
    id: 'free',
    type: 'availability',
    title: 'When are you free?',
    min: 8,
    max: 17.5,
    step: 30,
    settings: ['mon', 'tue', 'Wednesday', 'fri'],
  }),
  signup_slots: q({
    id: 'shift',
    type: 'signup_slots',
    title: 'Pick a shift',
    text: 'Bring gloves.',
    max: 2,
    settings: ['waitlist'],
    options: [
      opt('Sat 9–11am', 'sat_am', ['spots: 10', '2026-10-18 09:00-11:00']),
      opt('Sat 11–1pm', 'sat_mid', ['6 spots', '2026-10-18', '11:00–13:00']),
    ],
  }),
  review: q({
    id: 'check',
    type: 'review',
    title: 'Check your answers',
    text: 'Edit anything.',
    labels: ['Looks good'],
  }),
};

async function jsonSchemaOf(schema: Parameters<typeof asSchema>[0]): Promise<Json> {
  return (await asSchema(schema).jsonSchema) as Json;
}

/** Totals over a JSON schema: what makes a compiled grammar big. */
function measure(schema: Json) {
  let props = 0;
  let optional = 0;
  let enumValues = 0;
  let unions = 0;
  let objectArrayDepth = 0;
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Json;
    if (n.anyOf || n.oneOf || Array.isArray(n.type)) unions += 1;
    if (Array.isArray(n.enum)) enumValues += n.enum.length;
    let next = depth;
    if (n.type === 'array' && (n.items as Json | undefined)?.type === 'object') {
      next = depth + 1;
      objectArrayDepth = Math.max(objectArrayDepth, next);
    }
    if (n.type === 'object' && n.properties) {
      const keys = Object.keys(n.properties as Json);
      const required = new Set((n.required as string[] | undefined) ?? []);
      props += keys.length;
      optional += keys.filter((k) => !required.has(k)).length;
    }
    for (const v of Object.values(n)) walk(v, next);
  };
  walk(schema, 0);
  return { props, optional, enumValues, unions, objectArrayDepth };
}

describe('Build with AI grammar budget', () => {
  it('sends a schema far smaller than the full draft, with no optional or union fields', async () => {
    const model = measure(await jsonSchemaOf(modelFormSchema));
    const full = measure(await jsonSchemaOf(generatedFormSchema));
    // The full draft (80 fields, 52 enum values) is what Anthropic refused.
    expect(full.props).toBeGreaterThanOrEqual(80);
    // Below the original 50-field shape that compiled, with room to grow.
    expect(model.props).toBeLessThanOrEqual(40);
    expect(model.enumValues).toBeLessThanOrEqual(35);
    expect(model.optional).toBe(0);
    expect(model.unions).toBe(0);
    // questions[] → options[] and no deeper object arrays.
    expect(model.objectArrayDepth).toBeLessThanOrEqual(2);
  });

  it('every question type the editor can add is still in the model shape', async () => {
    const schema = await jsonSchemaOf(modelFormSchema);
    const items = ((schema.properties as Json).questions as Json).items as Json;
    const typeEnum = ((items.properties as Json).type as Json).enum as string[];
    expect([...typeEnum].sort()).toEqual([...GENERATED_QUESTION_TYPES].sort());
  });
});

describe('model draft → full draft → engine schema', () => {
  it('maps every type into a valid engine schema', () => {
    const all = Object.values(SAMPLES);
    const draft = form(all.slice(0, 24));
    const rest = form([...all.slice(24), SAMPLES.short_text, SAMPLES.email]);
    for (const f of [draft, rest]) {
      expect(modelFormSchema.safeParse(f).success).toBe(true);
      const full = fromModelForm(f);
      const { schema } = mapGeneratedForm(full);
      // The owner adds image_pin's photo and the location's center afterwards:
      // the AI never invents either (system prompt), so those two wait by design.
      const waiting = new Set(['no_image', 'bad_service_area']);
      expect(checkSchema(schema.questions).filter((i) => !waiting.has(i.kind))).toEqual([]);
    }
    const types = [...draft.questions, ...rest.questions].map((x) => x.type);
    expect(new Set(types)).toEqual(new Set(GENERATED_QUESTION_TYPES));
  });

  it('turns settings words and option extras into the editor’s own settings', () => {
    const full = fromModelForm(form(Object.values(SAMPLES).slice(0, 24)));
    const byId = Object.fromEntries(full.questions.map((x) => [x.id, x]));
    expect(byId.phone).toMatchObject({ defaultCountry: 'GB', placeholder: '07700 900123' });
    expect(byId.windows).toMatchObject({
      display: 'stepper',
      unit: 'windows',
      prefix: '#',
      unitPrice: 450,
    });
    expect(byId.visit).toMatchObject({ includeTime: true, format: 'DD/MM/YYYY', range: false });
    expect(byId.photos).toMatchObject({
      multiple: true,
      accept: 'image/*',
      maxFiles: 5,
      maxSizeMb: 10,
    });
    expect(byId.plan).toMatchObject({ display: 'cards', allowOther: true });
    expect(byId.plan!.options[1]).toMatchObject({
      price: 600,
      priceMax: 900,
      features: ['Two coats', 'Edging'],
      badge: 'Most popular',
    });
    expect(byId.style).toMatchObject({ display: 'swipe', multiple: true });
    expect(byId.style!.options[0]!.src).toBe('https://picsum.photos/seed/modern/400/300');
    expect(byId.grid!.rows.map((r) => r.value)).toEqual(['crew', 'cleanup']);
    expect(byId.grid!.columns).toEqual([
      { label: 'Poor', value: 'poor', src: '', alt: '' },
      { label: 'Good', value: 'good', src: '', alt: '' },
      { label: 'Great', value: 'great', src: '', alt: '' },
    ]);
    expect(byId.coming).toMatchObject({ yesLabel: 'Count me in', noLabel: 'Not this time' });
    expect(byId.terms).toMatchObject({
      body: 'You agree…',
      acceptLabel: 'I agree',
      declineLabel: 'No',
    });
    expect(byId.rate).toMatchObject({ display: 'stars', minLabel: 'Poor', maxLabel: 'Great' });
    expect(byId.where!.serviceArea).toEqual(['93101', '931']);
    expect(byId.sign).toMatchObject({ allowTyped: false, body: 'I authorize the work.' });
    expect(byId.intro).toMatchObject({ body: 'Two minutes.', cta: 'Got it', placeholder: '' });
  });

  it('reads availability hours, location radius and sign-up slots', () => {
    const rest = fromModelForm(
      form([
        SAMPLES.voice_note,
        SAMPLES.location,
        SAMPLES.availability,
        SAMPLES.signup_slots,
        SAMPLES.review,
      ]),
    );
    const byId = Object.fromEntries(rest.questions.map((x) => [x.id, x]));
    expect(byId.loc).toMatchObject({ radius: 25, radiusUnit: 'km' });
    expect(byId.free).toMatchObject({
      days: ['mon', 'tue', 'wed', 'fri'],
      startTime: '08:00',
      endTime: '17:30',
      step: 30,
    });
    expect(byId.shift).toMatchObject({ waitlist: true, max: 2, body: 'Bring gloves.' });
    expect(byId.shift!.options[0]).toMatchObject({
      capacity: 10,
      date: '2026-10-18',
      start: '09:00',
      end: '11:00',
    });
    expect(byId.shift!.options[1]).toMatchObject({
      capacity: 6,
      date: '2026-10-18',
      start: '11:00',
      end: '13:00',
    });
    expect(byId.check).toMatchObject({ subtitle: 'Edit anything.', cta: 'Looks good' });
    const { schema } = mapGeneratedForm(rest);
    const slots = schema.questions.find((x) => x.id === 'shift') as unknown as Json;
    expect(slots).toMatchObject({ waitlist: true, maxPicks: 2 });
    const avail = schema.questions.find((x) => x.id === 'free') as unknown as Json;
    expect(avail).toMatchObject({ startTime: '08:00', endTime: '17:30', slotMinutes: 30 });
  });

  it('leaves everything off when the model leaves settings empty', () => {
    const full = fromModelForm(
      form([
        q({ id: 'a', type: 'short_text', title: 'A?' }),
        q({ id: 'b', type: 'scale', title: 'B?', min: 1, max: 5 }),
        q({ id: 'c', type: 'location', title: 'C?' }),
      ]),
    );
    for (const x of full.questions) {
      expect(x).toMatchObject({
        allowOther: false,
        display: '',
        multiple: false,
        includeTime: false,
        range: false,
        allowTyped: true,
        radius: 0,
        radiusUnit: '',
        waitlist: false,
      });
    }
  });

  it('a draft round-trips through the model shape for a revision', () => {
    const original = form(Object.values(SAMPLES).slice(0, 24));
    const full = fromModelForm(original);
    expect(fromModelForm(toModelForm(full))).toEqual(full);
  });

  it('a later-wave draft round-trips too', () => {
    const later = fromModelForm(form(Object.values(SAMPLES).slice(20)));
    expect(fromModelForm(toModelForm(later))).toEqual(later);
  });
});

describe('model draft checks (what the one retry is told)', () => {
  const issues = (f: ModelForm) => {
    const r = modelFormSchema.safeParse(f);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  const base = [SAMPLES.short_text, SAMPLES.email];

  it('needs images on picture choices', () => {
    const noImages = q({
      id: 'pics',
      type: 'picture_choice',
      title: 'Pick',
      options: [opt('A', 'a'), opt('B', 'b')],
    });
    expect(issues(form([...base, noImages]))).toContain(
      'picture_choice options each need an https image URL in more',
    );
  });

  it('needs matrix rows and columns', () => {
    const grid = q({ id: 'grid', type: 'matrix', title: 'Rate', options: [opt('Crew', 'crew')] });
    expect(issues(form([...base, grid]))).toEqual([
      'matrix needs 2+ rows in options',
      'matrix needs 2+ column labels in labels',
    ]);
  });

  it('checks choices, scale bounds, ids and branches', () => {
    expect(
      issues(
        form([
          ...base,
          q({ id: 'one', type: 'single_choice', title: 'One', options: [opt('A', 'a')] }),
          q({ id: 'rate', type: 'scale', title: 'Rate', min: 5, max: 5 }),
          q({ id: 'name', type: 'short_text', title: 'Dup' }),
          q({
            id: 'follow',
            type: 'long_text',
            title: 'Why?',
            showIfField: 'ghost',
            showIfEquals: 'yes',
          }),
        ]),
      ),
    ).toEqual([
      'question ids must be unique',
      'single_choice needs at least 2 options',
      'scale min must be less than max',
      'showIf field "ghost" is not a question id',
    ]);
  });
});
