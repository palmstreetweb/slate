/**
 * Turn a validated AI draft into a Slate Schema (ADR-039).
 */

import type { Condition, Option, PictureOption, Question } from '../src/types/Question.js';
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

function visibilityOf(q: GeneratedQuestion, idMap: Map<string, string>): { visibleIf?: Condition } {
  const field = q.showIfField.trim();
  const equals = q.showIfEquals.trim();
  if (!field || !equals) return {};
  const mapped = idMap.get(field) ?? field;
  if (mapped === (idMap.get(q.id) ?? q.id)) return {};
  return { visibleIf: { field: mapped, op: 'equals', value: equals } };
}

function mapQuestion(q: GeneratedQuestion, id: string, vis: { visibleIf?: Condition }): Question {
  const title = q.title;
  const required = q.required;
  switch (q.type) {
    case 'statement':
      return {
        id,
        type: 'statement',
        title,
        body: text(q.body),
        cta: text(q.cta, 'Continue'),
        ...vis,
      };
    case 'short_text':
      return { id, type: 'short_text', title, placeholder: q.placeholder, required, ...vis };
    case 'long_text':
      return { id, type: 'long_text', title, placeholder: q.placeholder, required, ...vis };
    case 'email':
      return { id, type: 'email', title, placeholder: q.placeholder, required, ...vis };
    case 'phone':
      return {
        id,
        type: 'phone',
        title,
        placeholder: q.placeholder,
        required,
        defaultCountry: text(q.defaultCountry, 'US'),
        ...vis,
      };
    case 'url':
      return { id, type: 'url', title, placeholder: q.placeholder, required, ...vis };
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
        ...vis,
      };
    case 'date':
      return {
        id,
        type: 'date',
        title,
        required,
        format: q.format === 'DD/MM/YYYY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY',
        ...vis,
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
        ...vis,
      };
    case 'single_choice':
      return { id, type: 'single_choice', title, required, options: optionsOf(q), ...vis };
    case 'multi_choice':
      return {
        id,
        type: 'multi_choice',
        title,
        options: optionsOf(q),
        min: q.min,
        max: q.max || undefined,
        ...vis,
      };
    case 'dropdown':
      return {
        id,
        type: 'dropdown',
        title,
        options: optionsOf(q),
        placeholder: text(q.placeholder, 'Choose one'),
        required,
        ...vis,
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
        ...vis,
      };
    case 'ranking':
      return { id, type: 'ranking', title, options: optionsOf(q), ...vis };
    case 'matrix':
      return {
        id,
        type: 'matrix',
        title,
        rows: optionsOf({ ...q, options: q.rows }),
        columns: optionsOf({ ...q, options: q.columns }),
        multiple: q.multiple,
        required,
        ...vis,
      };
    case 'yes_no':
      return {
        id,
        type: 'yes_no',
        title,
        yesLabel: text(q.yesLabel, 'Yes'),
        noLabel: text(q.noLabel, 'No'),
        required,
        ...vis,
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
        ...vis,
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
        ...vis,
      };
    case 'nps':
      return {
        id,
        type: 'nps',
        title,
        minLabel: text(q.minLabel, 'Not at all likely'),
        maxLabel: text(q.maxLabel, 'Extremely likely'),
        required,
        ...vis,
      };
    case 'review':
      return {
        id,
        type: 'review',
        title,
        subtitle: text(q.subtitle),
        cta: text(q.cta, 'Looks good'),
        ...vis,
      };
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
    showIfField: '',
    showIfEquals: '',
    ...partial,
  };
}

export function blankGeneratedQuestion(
  partial: Pick<GeneratedQuestion, 'id' | 'type' | 'title'> & Partial<GeneratedQuestion>,
): GeneratedQuestion {
  return blankQuestion(partial);
}

function looksLikeQuestionTitle(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (/[?？]$/.test(t)) return true;
  return /^(how|what|when|where|why|who|which|can you|could you|would you|will you|do you|did you|are you|is there|have you)\b/i.test(
    t,
  );
}

function titlesMatch(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[?!.]+$/g, '')
      .replace(/\s+/g, ' ');
  return Boolean(n(a) && n(a) === n(b));
}

function thanksGreeting(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || looksLikeQuestionTitle(trimmed)) return 'Thank you.';
  return trimmed;
}

/**
 * Models often pin the first question on the welcome screen.
 * Welcome/thanks stay chrome: a greeting, then Start.
 */
function chromeFor(draft: GeneratedForm): {
  welcomeTitle: string;
  welcomeSubtitle?: string;
  welcomeCta?: string;
  thanksTitle: string;
  thanksSubtitle?: string;
  thanksCta?: string;
  opener: GeneratedQuestion | null;
} {
  const first = draft.questions[0];
  const rawWelcome = draft.welcome.title.trim();
  const stolenQuestion =
    looksLikeQuestionTitle(rawWelcome) || (first ? titlesMatch(rawWelcome, first.title) : false);
  const opener =
    stolenQuestion && !draft.questions.some((q) => titlesMatch(q.title, rawWelcome))
      ? blankQuestion({
          id: 'opener',
          type: 'long_text',
          title: rawWelcome,
          placeholder: 'A sentence or two is plenty.',
          required: true,
        })
      : null;

  return {
    welcomeTitle: stolenQuestion ? 'Welcome.' : rawWelcome || 'Welcome.',
    welcomeSubtitle: text(draft.welcome.subtitle, draft.description),
    welcomeCta: text(draft.welcome.cta, 'Start'),
    thanksTitle: thanksGreeting(draft.thanks.title),
    thanksSubtitle: text(draft.thanks.subtitle),
    thanksCta: text(draft.thanks.cta, 'Submit another'),
    opener,
  };
}

/** Convert model output into an engine Schema + dashboard name. */
export function mapGeneratedForm(draft: GeneratedForm): { name: string; schema: Schema } {
  const chrome = chromeFor(draft);
  const questions = chrome.opener ? [chrome.opener, ...draft.questions] : draft.questions;
  const used = new Set<string>(['welcome', 'done']);
  const idMap = new Map<string, string>();
  for (const q of questions) {
    idMap.set(q.id, slugId(q.id, used));
  }
  const middle = questions.map((q) =>
    mapQuestion(q, idMap.get(q.id) ?? q.id, visibilityOf(q, idMap)),
  );
  const schema: Schema = {
    brand: { name: draft.title },
    theme: draft.theme,
    themeMode: 'toggle',
    questions: [
      {
        id: 'welcome',
        type: 'welcome',
        title: chrome.welcomeTitle,
        subtitle: chrome.welcomeSubtitle,
        cta: chrome.welcomeCta,
      },
      ...middle,
      {
        id: 'done',
        type: 'thanks',
        title: chrome.thanksTitle,
        subtitle: chrome.thanksSubtitle,
        cta: chrome.thanksCta,
      },
    ],
  };
  return { name: draft.title, schema };
}
