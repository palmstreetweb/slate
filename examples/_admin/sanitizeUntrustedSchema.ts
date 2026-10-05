/**
 * A portable link (`/r?d=…`) carries a whole schema that anyone could have
 * written. The engine already refuses non-http(s) redirects; this strips the
 * rest of what a hostile schema could smuggle before it renders on our origin.
 */

import type { Schema, ThemeName } from '@/index.js';
import { themes } from '@/index.js';
import { withoutRepeatedOptions } from './uniqueOptions.js';

const MAX_TEXT = 2000;

function httpsOnly(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

function clampText<T>(v: T): T {
  return typeof v === 'string' && v.length > MAX_TEXT ? (v.slice(0, MAX_TEXT) as T) : v;
}

/** ADR-063 options: short labels, known enum values, real booleans — anything else is dropped. */
const SHORT_TEXT: Record<string, number> = { otherLabel: 40, prefix: 12, unit: 24, prefillKey: 40 };
const ENUMS: Record<string, readonly unknown[]> = {
  sliderIcon: ['emoji', 'stars', 'none'],
};
const DISPLAY: Record<string, readonly unknown[]> = {
  scale: ['numbers', 'stars', 'emoji', 'slider'],
  number: ['input', 'stepper'],
  single_choice: ['list', 'cards'],
  picture_choice: ['grid', 'swipe'],
  yes_no: ['buttons', 'swipe'],
};
const FLAGS = ['allowOther', 'includeTime', 'range', 'showEstimate', 'waitlist'];
/** Wave B options that are real booleans either way (ADR-064). */
const BOOLEANS = ['line2', 'country', 'allowTyped', 'notes'];
const PRICE_MAX = 10_000_000;

function price(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PRICE_MAX ? v : undefined;
}

/** Keep a numeric price key only when it's a sane number. */
function keepPrice(obj: Record<string, unknown>, key: string): void {
  if (!(key in obj)) return;
  const p = price(obj[key]);
  if (p === undefined) delete obj[key];
  else obj[key] = p;
}

/** Wave B (ADR-064): prices, card details, contact / address / signature settings. */
function sanitizeWaveB(next: Record<string, unknown>): void {
  keepPrice(next, 'unitPrice');
  keepPrice(next, 'unitPriceMax');
  for (const key of BOOLEANS) {
    if (key in next && typeof next[key] !== 'boolean') delete next[key];
  }
  if ('format' in next && next.format !== 'us' && next.format !== 'international') {
    delete next.format;
  }
  if ('defaultCountry' in next) {
    if (typeof next.defaultCountry === 'string' && /^[A-Za-z]{2}$/.test(next.defaultCountry)) {
      next.defaultCountry = next.defaultCountry.toUpperCase();
    } else delete next.defaultCountry;
  }
  if ('fields' in next) {
    const raw = next.fields;
    const modes = ['off', 'optional', 'required'];
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const f of ['name', 'email', 'phone']) {
        const m = (raw as Record<string, unknown>)[f];
        if (typeof m === 'string' && modes.includes(m)) out[f] = m;
      }
    }
    if (Object.keys(out).length) next.fields = out;
    else delete next.fields;
  }
  if ('serviceArea' in next) {
    const list = Array.isArray(next.serviceArea)
      ? (next.serviceArea as unknown[])
          .filter((z): z is string => typeof z === 'string')
          .map((z) => z.slice(0, 12))
          .slice(0, 500)
      : [];
    if (list.length) next.serviceArea = list;
    else delete next.serviceArea;
  }
  if ('body' in next) next.body = clampText(next.body);
}

/** A finite number in [lo, hi], or undefined. */
function bounded(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

/** Keep a numeric key only when it's in range. */
function keepBounded(obj: Record<string, unknown>, key: string, lo: number, hi: number): void {
  if (!(key in obj)) return;
  const n = bounded(obj[key], lo, hi);
  if (n === undefined) delete obj[key];
  else obj[key] = n;
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * Wave C (ADR-065): pins, voice, location, photo checklist and availability
 * settings in known shapes. A pin photo keeps only an https link — a studio
 * upload (a data: image) is left out of portable links, as the logo is.
 */
function sanitizeWaveC(next: Record<string, unknown>): void {
  if ('image' in next) {
    const safe = httpsOnly(next.image);
    if (safe) next.image = safe;
    else delete next.image;
  }
  if ('imageAlt' in next) {
    if (typeof next.imageAlt === 'string') next.imageAlt = next.imageAlt.slice(0, 200);
    else delete next.imageAlt;
  }
  keepBounded(next, 'maxPins', 1, 10);
  keepBounded(next, 'maxSeconds', 5, 300);
  keepBounded(next, 'radius', 0.1, 1000);
  if ('radiusUnit' in next && next.radiusUnit !== 'mi' && next.radiusUnit !== 'km') {
    delete next.radiusUnit;
  }
  if ('center' in next) {
    const c = next.center as Record<string, unknown> | null;
    const lat = c && typeof c === 'object' ? bounded(c.lat, -90, 90) : undefined;
    const lng = c && typeof c === 'object' ? bounded(c.lng, -180, 180) : undefined;
    if (lat !== undefined && lng !== undefined) next.center = { lat, lng };
    else delete next.center;
  }
  if ('privacyNote' in next) {
    if (typeof next.privacyNote === 'string') next.privacyNote = next.privacyNote.slice(0, 300);
    else delete next.privacyNote;
  }
  // Only a real `true` keeps the approximate location (ADR-068); anything else is verdict-only.
  if ('keepLocation' in next && next.keepLocation !== true) delete next.keepLocation;
  if ('days' in next) {
    const days = Array.isArray(next.days)
      ? [
          ...new Set(
            (next.days as unknown[]).filter((d): d is string => WEEKDAYS.includes(d as string)),
          ),
        ]
      : [];
    if (days.length) next.days = days;
    else delete next.days;
  }
  for (const key of ['startTime', 'endTime']) {
    if (
      key in next &&
      !(typeof next[key] === 'string' && /^\d{2}:\d{2}$/.test(next[key] as string))
    ) {
      delete next[key];
    }
  }
  if ('slotMinutes' in next && ![15, 30, 60, 120].includes(next.slotMinutes as number)) {
    delete next.slotMinutes;
  }
  if (Array.isArray(next.items)) {
    next.items = (next.items as unknown[])
      .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object')
      .slice(0, 30)
      .map((o) => ({
        label: typeof o.label === 'string' ? o.label.slice(0, 120) : '',
        value: typeof o.value === 'string' ? o.value.slice(0, 64) : '',
        ...(typeof o.description === 'string' ? { description: o.description.slice(0, 200) } : {}),
      }))
      .filter((o) => o.label && o.value);
  } else if ('items' in next) {
    delete next.items;
  }
}

/**
 * Wave D (ADR-066): sign-up slots in known shapes — a key the engine accepts,
 * 1–1,000 spots, a real `YYYY-MM-DD` and `HH:MM` times, short text; at most
 * 50 slots and 50 picks. A portable link has no server, so nothing counts
 * spots there (the slots show their capacity).
 */
function sanitizeWaveD(next: Record<string, unknown>): void {
  if (next.type !== 'signup_slots') return;
  keepBounded(next, 'maxPicks', 1, 50);
  if ('showRemaining' in next && typeof next.showRemaining !== 'boolean') delete next.showRemaining;
  if ('body' in next) next.body = clampText(next.body);
  next.slots = (Array.isArray(next.slots) ? (next.slots as unknown[]) : [])
    .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object')
    .slice(0, 50)
    .flatMap((o) => {
      const value =
        typeof o.value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.value) ? o.value : '';
      const capacity =
        typeof o.capacity === 'number' && Number.isInteger(o.capacity)
          ? bounded(o.capacity, 1, 1000)
          : undefined;
      if (!value || capacity === undefined) return [];
      const slot: Record<string, unknown> = {
        label: typeof o.label === 'string' ? o.label.slice(0, 120) : '',
        value,
        capacity,
      };
      if (typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) slot.date = o.date;
      for (const key of ['start', 'end']) {
        if (typeof o[key] === 'string' && /^\d{2}:\d{2}$/.test(o[key] as string))
          slot[key] = o[key];
      }
      if (typeof o.description === 'string') slot.description = o.description.slice(0, 200);
      return [slot];
    });
}

/** Most cells a scale from a link may draw: a 0–2,000,000 scale left the tab unresponsive (F14). */
const SCALE_CELLS_MAX = 101;
/** A slider draws no cells: it keeps its ends, and its step grows past this many stops. */
const SLIDER_STOPS_MAX = 1001;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Numbers that drive loops and limits (F14, decision 1): a scale's ends and
 * step (a step of 0 never finished drawing), bounds that leave no answer, a
 * text box that can't hold a letter, and pick counts nobody can meet.
 */
function sanitizeBounds(next: Record<string, unknown>): void {
  if (next.type === 'scale') {
    let min = finite(next.min) ? next.min : 0;
    let max = finite(next.max) ? next.max : 10;
    if (min > max) [min, max] = [max, min];
    if (!(finite(next.step) && next.step > 0)) delete next.step;
    const step = (next.step as number | undefined) ?? 1;
    if (next.display === 'slider') {
      // A 0–100 slider in steps of 0.5 stays exactly that; only a step so fine
      // the thumb couldn't land on it is coarsened (the ends never move).
      if ((max - min) / step > SLIDER_STOPS_MAX - 1)
        next.step = (max - min) / (SLIDER_STOPS_MAX - 1);
    } else if ((max - min) / step > SCALE_CELLS_MAX - 1) {
      max = min + step * (SCALE_CELLS_MAX - 1);
    }
    next.min = min;
    next.max = max;
  }
  if (next.type === 'number') {
    for (const key of ['min', 'max', 'step'])
      if (key in next && !finite(next[key])) delete next[key];
    if (finite(next.step) && next.step <= 0) delete next.step;
    if (finite(next.min) && finite(next.max) && next.min > next.max) {
      delete next.min;
      delete next.max;
    }
  }
  if (next.type === 'date') {
    const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    for (const key of ['min', 'max']) if (key in next && !iso(next[key])) delete next[key];
    if (iso(next.min) && iso(next.max) && (next.min as string) > (next.max as string)) {
      delete next.min;
      delete next.max;
    }
  }
  if ('maxLength' in next) {
    if (finite(next.maxLength) && next.maxLength >= 1) {
      next.maxLength = Math.min(Math.floor(next.maxLength), 10_000);
    } else delete next.maxLength;
  }
  const picks =
    next.type === 'multi_choice' || (next.type === 'picture_choice' && next.multiple === true);
  if (picks) {
    const choices =
      (Array.isArray(next.options) ? next.options.length : 0) + (next.allowOther === true ? 1 : 0);
    const min = finite(next.min) ? Math.min(Math.max(0, Math.floor(next.min)), choices) : 0;
    const max = finite(next.max) ? Math.floor(next.max) : 0;
    if (min > 0) next.min = min;
    else delete next.min;
    if (max >= 1 && max >= min) next.max = max;
    else delete next.max;
  } else if (next.type === 'picture_choice') {
    delete next.min;
    delete next.max;
  }
}

/**
 * A built-in theme, or the default (F31). 'slate' is the studio's own chrome:
 * on a form it pulled in studio input styles (the AM/PM toggle lost PM).
 */
export function safeThemeName(theme: unknown): ThemeName {
  return typeof theme === 'string' && Object.prototype.hasOwnProperty.call(themes, theme)
    ? (theme as ThemeName)
    : 'swiss';
}

function sanitizeOption(o: Record<string, unknown>): void {
  keepPrice(o, 'price');
  keepPrice(o, 'priceMax');
  if ('badge' in o) {
    if (typeof o.badge === 'string') o.badge = o.badge.slice(0, 24);
    else delete o.badge;
  }
  if ('features' in o) {
    const list = Array.isArray(o.features)
      ? (o.features as unknown[])
          .filter((f): f is string => typeof f === 'string')
          .map((f) => f.slice(0, 80))
          .slice(0, 6)
      : [];
    if (list.length) o.features = list;
    else delete o.features;
  }
}

/** `schema.estimate` (ADR-064): known keys, sane values. */
function sanitizeEstimate(raw: unknown): Schema['estimate'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency)) out.currency = r.currency;
  for (const key of ['base', 'baseMax']) {
    const p = price(r[key]);
    if (p !== undefined) out[key] = p;
  }
  const texts: Record<string, number> = { baseLabel: 60, label: 60, disclaimer: 200 };
  for (const [key, max] of Object.entries(texts)) {
    if (typeof r[key] === 'string') out[key] = (r[key] as string).slice(0, max);
  }
  if (r.breakdown === true) out.breakdown = true;
  return Object.keys(out).length ? (out as Schema['estimate']) : undefined;
}

function sanitizeOptions(next: Record<string, unknown>): void {
  for (const [key, max] of Object.entries(SHORT_TEXT)) {
    if (!(key in next)) continue;
    if (typeof next[key] === 'string') next[key] = (next[key] as string).slice(0, max);
    else delete next[key];
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (key in next && !allowed.includes(next[key])) delete next[key];
  }
  if ('display' in next) {
    const allowed = DISPLAY[String(next.type)] ?? [];
    if (!allowed.includes(next.display)) delete next.display;
  }
  for (const key of FLAGS) {
    if (key in next && next[key] !== true) delete next[key];
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A question the form can show at all: an object with an id and a type (SEC-3). */
const isQuestionLike = (q: unknown): q is Schema['questions'][number] =>
  isObject(q) && typeof q.id === 'string' && typeof q.type === 'string';

export function sanitizeUntrustedSchema(schema: Schema): Schema {
  // Anything in the list that isn't a question (null, a string, no id or type)
  // is left out: it would only crash the page (SEC-3).
  const listed = (Array.isArray(schema.questions) ? schema.questions : []).filter(isQuestionLike);
  const questions = withoutRepeatedOptions(listed).map((q) => {
    const next: Record<string, unknown> = { ...(q as Record<string, unknown>) };
    // A pattern from JSON is a string or {}, never a RegExp: the engine can't
    // test it, and a crafted one could hang the tab (NEW-01).
    delete next.pattern;
    for (const key of ['title', 'subtitle', 'description', 'placeholder', 'cta', 'label']) {
      if (key in next) next[key] = clampText(next[key]);
    }
    sanitizeOptions(next);
    sanitizeBounds(next);
    sanitizeWaveB(next);
    sanitizeWaveC(next);
    sanitizeWaveD(next);
    if ('redirectUrl' in next) {
      const safe = httpsOnly(next.redirectUrl);
      if (safe) next.redirectUrl = safe;
      else delete next.redirectUrl;
    }
    if (Array.isArray(next.options)) {
      next.options = (next.options as unknown[]).filter(isObject).map((opt) => {
        const o = { ...opt };
        if ('src' in o) {
          const safe = httpsOnly(o.src);
          if (safe) o.src = safe;
          else delete o.src;
        }
        for (const key of ['label', 'description']) if (key in o) o[key] = clampText(o[key]);
        sanitizeOption(o);
        return o;
      });
    }
    return next as unknown as Schema['questions'][number];
  });
  const brand = { ...schema.brand, name: clampText(schema.brand?.name ?? '') };
  if ('logo' in brand) delete (brand as Record<string, unknown>).logo;
  const estimate = sanitizeEstimate((schema as { estimate?: unknown }).estimate);
  const out: Schema = { ...schema, brand, questions, theme: safeThemeName(schema.theme) };
  if (estimate) out.estimate = estimate;
  else delete out.estimate;
  return out;
}
