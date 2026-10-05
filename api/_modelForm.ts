/**
 * The shape Claude fills for Build with AI (ADR-039), kept small on purpose.
 *
 * Anthropic compiles the structured-output schema into a grammar, and the
 * flat 46-field question (Waves A–D) outgrew it: every request failed with
 * "The compiled grammar is too large". Here each question has 13 fields and
 * each option 4. Rare settings are short words in `settings`, and option
 * extras (image, card features, slot spots and times, price ranges) are short
 * strings in `more`. `fromModelForm` expands a draft into the full
 * `GeneratedForm` the studio and `mapGeneratedForm` already use, so nothing
 * downstream changes; `toModelForm` goes back for a revision prompt.
 * Field descriptions are guidance only: they are not part of the grammar.
 * The leading underscore keeps this helper from becoming a Vercel Function.
 */

import { z } from 'zod';
import {
  GENERATED_QUESTION_MAX,
  GENERATED_QUESTION_TYPES,
  generatedFormSchema,
  type GeneratedForm,
  type GeneratedQuestion,
  type GeneratedQuestionType,
} from './generateFormSchema.js';

const id = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'ids must be snake_case starting with a letter');

const modelOptionSchema = z.object({
  label: z.string().describe('What the person sees.'),
  value: z.string().describe('Stable snake_case id, e.g. "chicken".'),
  price: z.number().describe('Price the user gave for this option. 0 = no price.'),
  more: z
    .array(z.string())
    .describe(
      'Extras, usually []. picture_choice: the https image URL. Package cards: up to 6 short features and "badge: Most popular". Price range: "up to 12000". signup_slots: "spots: 8", the day "2026-10-18" and the time "09:00-11:00".',
    ),
});

const modelQuestionSchema = z.object({
  id,
  type: z.enum(GENERATED_QUESTION_TYPES),
  title: z.string().min(1),
  text: z
    .string()
    .describe(
      'Placeholder for typed answers and dropdowns; the body for statement, legal, signature, voice_note and signup_slots; the subtitle for review. Otherwise "".',
    ),
  required: z.boolean(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  options: z
    .array(modelOptionSchema)
    .describe('Choices, ranking items, matrix rows, photo_checklist shots or signup_slots slots.'),
  labels: z
    .array(z.string())
    .describe(
      'yes_no [yes, no]; legal [accept, decline]; scale and nps [low end, high end]; statement and review [button]; matrix: the column labels; address: ZIP codes served. Otherwise [].',
    ),
  settings: z
    .array(z.string())
    .describe('Short words that switch extras on, from the system prompt. Usually [].'),
  showIfField: z.string().describe('Earlier question id. "" = always shown.'),
  showIfEquals: z.string().describe('That question’s stored value, not its label.'),
});

const screen = z.object({ title: z.string().min(1), subtitle: z.string(), cta: z.string() });

/** One question's grammar-facing fields. */
export type ModelQuestion = z.infer<typeof modelQuestionSchema>;
export type ModelOption = z.infer<typeof modelOptionSchema>;

const modelFormShape = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(280),
  theme: z.enum(['editorial', 'swiss']),
  welcome: screen,
  questions: z.array(modelQuestionSchema).min(3).max(GENERATED_QUESTION_MAX),
  thanks: screen,
  /** Instant estimate on the thanks screen (ADR-064); show false = none. */
  estimate: z.object({
    show: z.boolean(),
    currency: z.string(),
    base: z.number(),
    disclaimer: z.string(),
  }),
});

export type ModelForm = z.infer<typeof modelFormShape>;

const NEEDS_OPTIONS = new Set<GeneratedQuestionType>([
  'single_choice',
  'multi_choice',
  'dropdown',
  'picture_choice',
  'ranking',
  'photo_checklist',
]);

/**
 * The checks the full schema makes, worded in this shape's terms, so the one
 * retry tells the model what to fix ("needs at least 2 options").
 */
export const modelFormSchema = modelFormShape.superRefine((val, ctx) => {
  const ids = val.questions.map((q) => q.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'question ids must be unique', path: ['questions'] });
  }
  val.questions.forEach((q, i) => {
    const path = ['questions', i] as const;
    const named = q.options.filter((o) => o.label.trim() && o.value.trim());
    if (NEEDS_OPTIONS.has(q.type) && named.length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: `${q.type} needs at least 2 options`,
        path: [...path, 'options'],
      });
    }
    if (q.type === 'picture_choice' && named.filter((o) => imageOf(o.more)).length < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'picture_choice options each need an https image URL in more',
        path: [...path, 'options'],
      });
    }
    if (q.type === 'signup_slots' && named.length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'signup_slots needs at least 1 slot in options',
        path: [...path, 'options'],
      });
    }
    if (q.type === 'matrix') {
      if (named.length < 2) {
        ctx.addIssue({
          code: 'custom',
          message: 'matrix needs 2+ rows in options',
          path: [...path, 'options'],
        });
      }
      if (q.labels.filter((l) => l.trim()).length < 2) {
        ctx.addIssue({
          code: 'custom',
          message: 'matrix needs 2+ column labels in labels',
          path: [...path, 'labels'],
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

// ---------------------------------------------------------------------------
// Settings words and option extras
// ---------------------------------------------------------------------------

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];

/** A setting is a word ("other") or "key: value" ("unit: sq ft"). */
function readSettings(list: readonly string[]): {
  words: Set<string>;
  values: Map<string, string>;
} {
  const words = new Set<string>();
  const values = new Map<string, string>();
  for (const raw of list) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t) continue;
    const pair = /^([a-z][a-z ]{0,20}?)\s*[:=]\s*(.+)$/i.exec(t);
    if (pair) {
      values.set(pair[1]!.toLowerCase().replace(/\s+/g, ' '), pair[2]!.trim());
      continue;
    }
    words.add(t.toLowerCase().replace(/[\s_]+/g, '-'));
  }
  return { words, values };
}

const DAY_WORDS: Record<string, readonly Day[]> = {
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekend: ['sat', 'sun'],
  weekends: ['sat', 'sun'],
  everyday: DAYS,
  'every-day': DAYS,
};

function daysOf(words: Set<string>): Day[] {
  const out = new Set<Day>();
  for (const w of words) {
    const short = w.slice(0, 3) as Day;
    if ((DAYS as readonly string[]).includes(short) && /^[a-z]+$/.test(w)) out.add(short);
    for (const d of DAY_WORDS[w] ?? []) out.add(d);
  }
  return DAYS.filter((d) => out.has(d));
}

function numberOf(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 8 → "08:00", 17.5 → "17:30", 830 → "08:30". Out of range → "". */
function hourText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const hours = value >= 100 ? Math.floor(value / 100) + (value % 100) / 60 : value;
  if (hours > 24) return '';
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hourNumber(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return 0;
  return Number(m[1]) + Number(m[2]) / 60;
}

function clock(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : '';
}

function imageOf(more: readonly string[]): string {
  return more.map((s) => s.trim()).find((s) => /^https:\/\/\S+$/i.test(s)) ?? '';
}

type FullOption = GeneratedQuestion['options'][number];

function fromModelOption(o: ModelOption): FullOption {
  const out: FullOption = {
    label: o.label,
    value: o.value,
    src: '',
    alt: '',
    price: o.price,
    priceMax: 0,
    features: [],
    badge: '',
    capacity: 0,
    date: '',
    start: '',
    end: '',
  };
  for (const raw of o.more) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t) continue;
    let m: RegExpExecArray | null;
    if (/^https:\/\/\S+$/i.test(t)) {
      if (!out.src) out.src = t;
    } else if ((m = /^badge\s*[:=]\s*(.+)$/i.exec(t))) {
      out.badge = m[1]!.trim();
    } else if ((m = /^(?:up to|max)\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d+)?)$/i.exec(t))) {
      out.priceMax = numberOf(m[1]);
    } else if (
      (m = /^(\d{1,4})\s*(?:spots?|places?|seats?)$/i.exec(t)) ||
      (m = /^(?:spots?|places?|seats?|capacity)\s*[:=]?\s*(\d{1,4})$/i.exec(t))
    ) {
      out.capacity = Number(m[1]);
    } else if (
      (m =
        /^(\d{4}-\d{2}-\d{2})?\s*(?:(\d{1,2}:\d{2})\s*(?:(?:-|–|—|to)\s*(\d{1,2}:\d{2}))?)?$/i.exec(
          t,
        )) &&
      (m[1] || m[2])
    ) {
      if (m[1]) out.date = m[1];
      if (m[2]) out.start = clock(m[2]);
      if (m[3]) out.end = clock(m[3]);
    } else {
      out.features.push(t);
    }
  }
  return out;
}

function toModelOption(o: FullOption): ModelOption {
  const more: string[] = [];
  if (o.src?.trim()) more.push(o.src.trim());
  if (o.priceMax > 0 && o.priceMax > o.price) more.push(`up to ${o.priceMax}`);
  for (const f of o.features ?? []) if (f.trim()) more.push(f.trim());
  if (o.badge?.trim()) more.push(`badge: ${o.badge.trim()}`);
  if (o.capacity > 0) more.push(`spots: ${o.capacity}`);
  const when = [o.date?.trim(), o.start?.trim() ? [o.start, o.end].filter(Boolean).join('-') : '']
    .filter(Boolean)
    .join(' ');
  if (when) more.push(when);
  return { label: o.label, value: o.value, price: o.price, more };
}

function slug(label: string, used: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'column';
  const start = /^[a-z]/.test(base) ? base : `c_${base}`;
  let next = start;
  for (let n = 2; used.has(next); n += 1) next = `${start}_${n}`;
  used.add(next);
  return next;
}

const DISPLAY_FOR: Partial<
  Record<GeneratedQuestionType, Record<string, GeneratedQuestion['display']>>
> = {
  scale: { stars: 'stars', faces: 'emoji', emoji: 'emoji', slider: 'slider' },
  number: { stepper: 'stepper' },
  single_choice: { cards: 'cards' },
  picture_choice: { swipe: 'swipe' },
  yes_no: { swipe: 'swipe' },
};

const TYPING_OFF = ['typing-off', 'no-typing', 'audio-only', 'draw-only'];

function fromModelQuestion(q: ModelQuestion): GeneratedQuestion {
  const { words, values } = readSettings(q.settings);
  const labels = q.labels.map((l) => (typeof l === 'string' ? l.trim() : ''));
  const text = q.text;
  const display =
    Object.entries(DISPLAY_FOR[q.type] ?? {}).find(([word]) => words.has(word))?.[1] ?? '';
  const isMatrix = q.type === 'matrix';
  const usedColumns = new Set<string>();
  const country = (values.get('country') ?? '').toUpperCase();

  return {
    id: q.id,
    type: q.type,
    title: q.title,
    placeholder: [
      'statement',
      'legal',
      'signature',
      'voice_note',
      'signup_slots',
      'review',
    ].includes(q.type)
      ? ''
      : text,
    body: ['statement', 'legal', 'signature', 'voice_note', 'signup_slots'].includes(q.type)
      ? text
      : '',
    cta: q.type === 'statement' || q.type === 'review' ? (labels[0] ?? '') : '',
    subtitle: q.type === 'review' ? text : '',
    required: q.required,
    defaultCountry: q.type === 'phone' && /^[A-Z]{2}$/.test(country) ? country : '',
    min: q.type === 'availability' ? 0 : q.min,
    max: q.type === 'availability' ? 0 : q.max,
    step: q.step,
    format: q.type === 'date' && words.has('day-first') ? 'DD/MM/YYYY' : '',
    accept: q.type === 'file_upload' ? (values.get('accept') ?? '') : '',
    maxSizeMb:
      q.type === 'file_upload' ? numberOf(values.get('max size') ?? values.get('size')) : 0,
    multiple: words.has('multiple'),
    maxFiles:
      q.type === 'file_upload' ? numberOf(values.get('max files') ?? values.get('files')) : 0,
    yesLabel: q.type === 'yes_no' ? (labels[0] ?? '') : '',
    noLabel: q.type === 'yes_no' ? (labels[1] ?? '') : '',
    acceptLabel: q.type === 'legal' ? (labels[0] ?? '') : '',
    declineLabel: q.type === 'legal' ? (labels[1] ?? '') : '',
    minLabel: q.type === 'scale' || q.type === 'nps' ? (labels[0] ?? '') : '',
    maxLabel: q.type === 'scale' || q.type === 'nps' ? (labels[1] ?? '') : '',
    options: isMatrix ? [] : q.options.map(fromModelOption),
    rows: isMatrix
      ? q.options.map((o) => ({ label: o.label, value: o.value, src: '', alt: '' }))
      : [],
    columns: isMatrix
      ? labels
          .filter(Boolean)
          .map((label) => ({ label, value: slug(label, usedColumns), src: '', alt: '' }))
      : [],
    allowOther: words.has('other'),
    display,
    unitPrice: q.type === 'number' ? numberOf(values.get('price') ?? values.get('unit price')) : 0,
    serviceArea: q.type === 'address' ? labels.filter(Boolean) : [],
    unit: q.type === 'number' ? (values.get('unit') ?? '') : '',
    prefix: q.type === 'number' ? (values.get('prefix') ?? '') : '',
    includeTime: words.has('time'),
    range: words.has('range'),
    allowTyped: !TYPING_OFF.some((w) => words.has(w)),
    radius: q.type === 'location' ? q.max : 0,
    radiusUnit: q.type === 'location' && q.max > 0 ? (words.has('km') ? 'km' : 'mi') : '',
    days: q.type === 'availability' ? daysOf(words) : [],
    startTime: q.type === 'availability' ? hourText(q.min) : '',
    endTime: q.type === 'availability' ? hourText(q.max) : '',
    waitlist: words.has('waitlist'),
    showIfField: q.showIfField,
    showIfEquals: q.showIfEquals,
  };
}

const DISPLAY_WORD: Partial<Record<GeneratedQuestion['display'], string>> = {
  stars: 'stars',
  emoji: 'faces',
  slider: 'slider',
  stepper: 'stepper',
  cards: 'cards',
  swipe: 'swipe',
};

function toModelQuestion(q: GeneratedQuestion): ModelQuestion {
  const settings: string[] = [];
  if (q.allowOther) settings.push('other');
  if (q.multiple) settings.push('multiple');
  if (q.includeTime) settings.push('time');
  if (q.range) settings.push('range');
  if (q.format === 'DD/MM/YYYY') settings.push('day-first');
  const word = DISPLAY_WORD[q.display];
  if (word) settings.push(word);
  if (q.allowTyped === false && (q.type === 'signature' || q.type === 'voice_note')) {
    settings.push('typing-off');
  }
  if (q.waitlist) settings.push('waitlist');
  if (q.type === 'location' && q.radiusUnit === 'km') settings.push('km');
  if (q.type === 'availability') settings.push(...(q.days ?? []));
  if (q.unit?.trim()) settings.push(`unit: ${q.unit.trim()}`);
  if (q.prefix?.trim()) settings.push(`prefix: ${q.prefix.trim()}`);
  if (q.unitPrice > 0) settings.push(`price: ${q.unitPrice}`);
  if (q.type === 'phone' && q.defaultCountry?.trim() && q.defaultCountry.trim() !== 'US') {
    settings.push(`country: ${q.defaultCountry.trim()}`);
  }
  if (q.accept?.trim()) settings.push(`accept: ${q.accept.trim()}`);
  if (q.maxFiles > 0) settings.push(`max files: ${q.maxFiles}`);
  if (q.maxSizeMb > 0) settings.push(`max size: ${q.maxSizeMb}`);

  const labels =
    q.type === 'yes_no'
      ? [q.yesLabel, q.noLabel]
      : q.type === 'legal'
        ? [q.acceptLabel, q.declineLabel]
        : q.type === 'scale' || q.type === 'nps'
          ? [q.minLabel, q.maxLabel]
          : q.type === 'statement' || q.type === 'review'
            ? [q.cta]
            : q.type === 'matrix'
              ? q.columns.map((c) => c.label)
              : q.type === 'address'
                ? (q.serviceArea ?? [])
                : [];

  const text =
    q.type === 'review'
      ? q.subtitle
      : ['statement', 'legal', 'signature', 'voice_note', 'signup_slots'].includes(q.type)
        ? q.body
        : q.placeholder;

  return {
    id: q.id,
    type: q.type,
    title: q.title,
    text,
    required: q.required,
    min: q.type === 'availability' ? hourNumber(q.startTime ?? '') : q.min,
    max:
      q.type === 'availability'
        ? hourNumber(q.endTime ?? '')
        : q.type === 'location'
          ? q.radius
          : q.max,
    step: q.step,
    options:
      q.type === 'matrix'
        ? q.rows.map((r) => ({ label: r.label, value: r.value, price: 0, more: [] }))
        : q.options.map(toModelOption),
    labels: labels.filter((l) => l.trim()),
    settings,
    showIfField: q.showIfField,
    showIfEquals: q.showIfEquals,
  };
}

/** Expand what the model wrote into the studio's full draft shape. */
export function fromModelForm(form: ModelForm): GeneratedForm {
  return generatedFormSchema.parse({
    title: form.title,
    description: form.description,
    theme: form.theme,
    welcome: form.welcome,
    questions: form.questions.map(fromModelQuestion),
    thanks: form.thanks,
    estimate: form.estimate,
  });
}

/** A full draft in the model's shape, for "Current draft:" in a revision prompt. */
export function toModelForm(form: GeneratedForm): ModelForm {
  return {
    title: form.title,
    description: form.description,
    theme: form.theme,
    welcome: form.welcome,
    questions: form.questions.map(toModelQuestion),
    thanks: form.thanks,
    estimate: form.estimate,
  };
}
