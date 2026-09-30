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

const PRICE_MAX = 10_000_000;

/** A usable price, or undefined (0 means "no price" in drafts). */
function priceOf(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= PRICE_MAX ? n : undefined;
}

/** Price, range and card details from a drafted option (ADR-064), only when set. */
function pricedExtras(
  o: Partial<GeneratedQuestion['options'][number]>,
  cards: boolean,
): Partial<Option> {
  const out: Partial<Option> = {};
  const price = priceOf(o.price);
  if (price !== undefined) {
    out.price = price;
    const max = priceOf(o.priceMax);
    if (max !== undefined && max > price) out.priceMax = max;
  }
  if (cards) {
    const features = (o.features ?? [])
      .map((f) => f.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 6);
    if (features.length) out.features = features;
    const badge = o.badge?.trim().slice(0, 24);
    if (badge) out.badge = badge;
  }
  return out;
}

/** Matrix rows / columns: label and value only. */
function plainOptions(list: ReadonlyArray<{ label: string; value: string }>): Option[] {
  return list
    .filter((o) => o.label.trim() && o.value.trim())
    .map((o) => ({ label: o.label.trim(), value: o.value.trim() }));
}

function optionsOf(q: GeneratedQuestion, cards = false): Option[] {
  return q.options
    .filter((o) => o.label.trim() && o.value.trim())
    .map((o) => ({ label: o.label.trim(), value: o.value.trim(), ...pricedExtras(o, cards) }));
}

function pictureOptionsOf(q: GeneratedQuestion): PictureOption[] {
  return q.options
    .filter((o) => o.label.trim() && o.value.trim() && o.src.trim())
    .map((o) => ({
      label: o.label.trim(),
      value: o.value.trim(),
      src: o.src.trim(),
      alt: text(o.alt, o.label.trim()),
      ...pricedExtras(o, false),
    }));
}

/** `allowOther` only when the model set it (ADR-063). */
function otherOf(q: GeneratedQuestion): { allowOther?: true } {
  return q.allowOther ? { allowOther: true } : {};
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
        ...(q.display === 'stepper' ? { display: 'stepper' as const } : {}),
        ...(text(q.unit) ? { unit: text(q.unit)!.slice(0, 24) } : {}),
        ...(text(q.prefix) ? { prefix: text(q.prefix)!.slice(0, 12) } : {}),
        ...(priceOf(q.unitPrice) !== undefined ? { unitPrice: priceOf(q.unitPrice) } : {}),
        ...vis,
      };
    case 'date':
      return {
        id,
        type: 'date',
        title,
        required,
        format: q.format === 'DD/MM/YYYY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY',
        ...(q.includeTime ? { includeTime: true } : {}),
        ...(q.range ? { range: true } : {}),
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
      return {
        id,
        type: 'single_choice',
        title,
        required,
        options: optionsOf(q, q.display === 'cards'),
        ...(q.display === 'cards' ? { display: 'cards' as const } : {}),
        ...otherOf(q),
        ...vis,
      };
    case 'multi_choice':
      return {
        id,
        type: 'multi_choice',
        title,
        options: optionsOf(q),
        min: q.min,
        max: q.max || undefined,
        ...otherOf(q),
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
        ...otherOf(q),
        ...vis,
      };
    case 'picture_choice':
      return {
        id,
        type: 'picture_choice',
        title,
        options: pictureOptionsOf(q),
        // Swipe cards store the liked list, so they turn on multi-select (ADR-065).
        multiple: q.display === 'swipe' ? true : q.multiple,
        ...(q.display === 'swipe' ? { display: 'swipe' as const } : {}),
        required,
        min: q.min,
        max: q.max || undefined,
        ...otherOf(q),
        ...vis,
      };
    case 'ranking':
      return { id, type: 'ranking', title, options: optionsOf(q), ...vis };
    case 'matrix':
      return {
        id,
        type: 'matrix',
        title,
        rows: plainOptions(q.rows),
        columns: plainOptions(q.columns),
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
        ...(q.display === 'swipe' ? { display: 'swipe' as const } : {}),
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
        ...(q.display === 'stars' || q.display === 'emoji' || q.display === 'slider'
          ? { display: q.display }
          : {}),
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
    case 'contact_info':
      return { id, type: 'contact_info', title, ...vis };
    case 'address': {
      const area = (q.serviceArea ?? [])
        .map((z) => z.trim().toUpperCase())
        .filter((z) => /^[A-Z0-9 -]{1,12}\*?$/.test(z))
        .slice(0, 500);
      return {
        id,
        type: 'address',
        title,
        required,
        ...(area.length ? { serviceArea: area } : {}),
        ...vis,
      };
    }
    case 'signature':
      return {
        id,
        type: 'signature',
        title,
        body: text(q.body),
        required,
        ...(q.allowTyped === false ? { allowTyped: false } : {}),
        ...vis,
      };
    // Wave C (ADR-065)
    case 'image_pin':
      return {
        id,
        type: 'image_pin',
        title,
        required,
        maxPins: Math.min(10, Math.max(1, Math.round(q.max || 3))),
        ...vis,
      };
    case 'voice_note':
      return {
        id,
        type: 'voice_note',
        title,
        body: text(q.body),
        required,
        maxSeconds: Math.min(300, Math.max(5, Math.round(q.max || 60))),
        ...(q.allowTyped === false ? { allowTyped: false } : {}),
        ...vis,
      };
    case 'location':
      return {
        id,
        type: 'location',
        title,
        required,
        ...(q.radius > 0 && q.radius <= 1000
          ? { radius: q.radius, radiusUnit: q.radiusUnit === 'km' ? ('km' as const) : ('mi' as const) }
          : {}),
        ...vis,
      };
    case 'photo_checklist':
      return {
        id,
        type: 'photo_checklist',
        title,
        required,
        items: plainOptions(q.options).slice(0, 30),
        ...vis,
      };
    case 'availability': {
      const time = (t: string) => (/^([01]\d|2[0-4]):[0-5]\d$/.test(t.trim()) ? t.trim() : undefined);
      const slot = [15, 30, 60, 120].includes(q.step) ? q.step : undefined;
      const days = [...new Set(q.days ?? [])];
      return {
        id,
        type: 'availability',
        title,
        required,
        ...(days.length ? { days } : {}),
        ...(time(q.startTime) ? { startTime: time(q.startTime) } : {}),
        ...(time(q.endTime) ? { endTime: time(q.endTime) } : {}),
        ...(slot ? { slotMinutes: slot } : {}),
        ...vis,
      };
    }
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
    allowOther: false,
    display: '',
    unit: '',
    prefix: '',
    includeTime: false,
    range: false,
    unitPrice: 0,
    serviceArea: [],
    allowTyped: true,
    radius: 0,
    radiusUnit: '',
    days: [],
    startTime: '',
    endTime: '',
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
  // Instant estimate (ADR-064): only when asked for and something has a price.
  const priced = middle.some(
    (q) =>
      ('options' in q && q.options.some((o) => typeof o.price === 'number')) ||
      (q.type === 'number' && typeof q.unitPrice === 'number'),
  );
  const est = draft.estimate;
  const showEstimate = Boolean(est?.show) && (priced || priceOf(est?.base) !== undefined);
  const currency = /^[A-Z]{3}$/.test(est?.currency ?? '') ? est!.currency : 'USD';
  const schema: Schema = {
    brand: { name: draft.title },
    theme: draft.theme,
    themeMode: 'toggle',
    ...(showEstimate
      ? {
          estimate: {
            ...(currency !== 'USD' ? { currency } : {}),
            ...(priceOf(est!.base) !== undefined ? { base: priceOf(est!.base) } : {}),
            ...(text(est!.disclaimer) ? { disclaimer: text(est!.disclaimer)!.slice(0, 200) } : {}),
            breakdown: true,
          },
        }
      : {}),
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
        ...(showEstimate ? { showEstimate: true } : {}),
      },
    ],
  };
  return { name: draft.title, schema };
}
