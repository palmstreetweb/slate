/**
 * Turn a validated AI draft into a Slate Schema (ADR-039).
 */

import type { Option, PictureOption, Question } from '../src/types/Question.js';
import type { Schema } from '../src/types/Schema.js';
import type { GeneratedForm, GeneratedQuestion } from './generateFormSchema.js';

function slugId(raw: string, used: Set<string>): string {
  const base =
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'question';
  const start = /^[a-z]/.test(base) ? base : `q_${base}`;
  if (!used.has(start)) {
    used.add(start);
    return start;
  }
  let n = 2;
  while (used.has(`${start}_${n}`)) n += 1;
  const next = `${start}_${n}`;
  used.add(next);
  return next;
}

function text(value: string, fallback?: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed) return trimmed;
  return fallback;
}

function optionsOf(q: GeneratedQuestion): Option[] {
  return q.options
    .filter((o) => o.label.trim() && o.value.trim())
    .map((o) => ({ label: o.label.trim(), value: o.value.trim() }));
}

function pictureOptionsOf(q: GeneratedQuestion): PictureOption[] {
  return q.options
    .filter((o) => o.label.trim() && o.value.trim() && o.src.trim())
    .map((o) => ({
      label: o.label.trim(),
      value: o.value.trim(),
      src: o.src.trim(),
      alt: text(o.alt, o.label.trim()),
    }));
}

function mapQuestion(q: GeneratedQuestion, used: Set<string>): Question {
  const id = slugId(q.id, used);
  const title = q.title;
  const required = q.required;
  switch (q.type) {
    case 'statement':
      return { id, type: 'statement', title, body: text(q.body), cta: text(q.cta, 'Continue') };
    case 'short_text':
      return { id, type: 'short_text', title, placeholder: q.placeholder, required };
    case 'long_text':
      return { id, type: 'long_text', title, placeholder: q.placeholder, required };
    case 'email':
      return { id, type: 'email', title, placeholder: q.placeholder, required };
    case 'phone':
      return {
        id,
        type: 'phone',
        title,
        placeholder: q.placeholder,
        required,
        defaultCountry: text(q.defaultCountry, 'US'),
      };
    case 'url':
      return { id, type: 'url', title, placeholder: q.placeholder, required };
    case 'number':
      return {
        id,
        type: 'number',
        title,
        placeholder: q.placeholder,
        required,
        min: q.min,
        max: q.max,
        step: q.step || 1,
      };
    case 'date':
      return {
        id,
        type: 'date',
        title,
        required,
        format: q.format === 'DD/MM/YYYY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY',
      };
    case 'file_upload':
      return {
        id,
        type: 'file_upload',
        title,
        required,
        accept: text(q.accept),
        maxSizeMb: q.maxSizeMb || undefined,
        multiple: q.multiple,
        maxFiles: q.maxFiles || undefined,
      };
    case 'single_choice':
      return { id, type: 'single_choice', title, required, options: optionsOf(q) };
    case 'multi_choice':
      return { id, type: 'multi_choice', title, options: optionsOf(q), min: q.min, max: q.max || undefined };
    case 'dropdown':
      return {
        id,
        type: 'dropdown',
        title,
        options: optionsOf(q),
        placeholder: text(q.placeholder, 'Choose one'),
        required,
      };
    case 'picture_choice':
      return {
        id,
        type: 'picture_choice',
        title,
        options: pictureOptionsOf(q),
        multiple: q.multiple,
        required,
        min: q.min,
        max: q.max || undefined,
      };
    case 'ranking':
      return { id, type: 'ranking', title, options: optionsOf(q) };
    case 'matrix':
      return {
        id,
        type: 'matrix',
        title,
        rows: optionsOf({ ...q, options: q.rows }),
        columns: optionsOf({ ...q, options: q.columns }),
        multiple: q.multiple,
        required,
      };
    case 'yes_no':
      return {
        id,
        type: 'yes_no',
        title,
        yesLabel: text(q.yesLabel, 'Yes'),
        noLabel: text(q.noLabel, 'No'),
        required,
      };
    case 'legal':
      return {
        id,
        type: 'legal',
        title,
        body: text(q.body),
        acceptLabel: text(q.acceptLabel, 'Accept'),
        declineLabel: text(q.declineLabel, 'Decline'),
        required,
      };
    case 'scale':
      return {
        id,
        type: 'scale',
        title,
        min: q.min,
        max: q.max,
        minLabel: text(q.minLabel),
        maxLabel: text(q.maxLabel),
        required,
      };
    case 'nps':
      return {
        id,
        type: 'nps',
        title,
        minLabel: text(q.minLabel, 'Not at all likely'),
        maxLabel: text(q.maxLabel, 'Extremely likely'),
        required,
      };
    case 'review':
      return { id, type: 'review', title, subtitle: text(q.subtitle), cta: text(q.cta, 'Looks good') };
  }
}

function blankQuestion(
  partial: Pick<GeneratedQuestion, 'id' | 'type' | 'title'> & Partial<GeneratedQuestion>,
): GeneratedQuestion {
  return {
    placeholder: '',
    body: '',
    cta: '',
    subtitle: '',
    required: false,
    defaultCountry: '',
    min: 0,
    max: 0,
    step: 0,
    format: '',
    accept: '',
    maxSizeMb: 0,
    multiple: false,
    maxFiles: 0,
    yesLabel: '',
    noLabel: '',
    acceptLabel: '',
    declineLabel: '',
    minLabel: '',
    maxLabel: '',
    options: [],
    rows: [],
    columns: [],
    ...partial,
  };
}

export function blankGeneratedQuestion(
  partial: Pick<GeneratedQuestion, 'id' | 'type' | 'title'> & Partial<GeneratedQuestion>,
): GeneratedQuestion {
  return blankQuestion(partial);
}

/** Convert model output into an engine Schema + dashboard name. */
export function mapGeneratedForm(draft: GeneratedForm): { name: string; schema: Schema } {
  const used = new Set<string>(['welcome', 'done']);
  const middle = draft.questions.map((q) => mapQuestion(q, used));
  const welcomeSubtitle = text(draft.welcome.subtitle, draft.description);
  const schema: Schema = {
    brand: { name: draft.title },
    theme: draft.theme,
    themeMode: 'toggle',
    questions: [
      {
        id: 'welcome',
        type: 'welcome',
        title: draft.welcome.title,
        subtitle: welcomeSubtitle,
        cta: text(draft.welcome.cta, 'Start'),
      },
      ...middle,
      {
        id: 'done',
        type: 'thanks',
        title: draft.thanks.title,
        subtitle: text(draft.thanks.subtitle),
        cta: text(draft.thanks.cta, 'Submit another'),
      },
    ],
  };
  return { name: draft.title, schema };
}
