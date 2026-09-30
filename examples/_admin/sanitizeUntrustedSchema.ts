/**
 * A portable link (`/r?d=…`) carries a whole schema that anyone could have
 * written. The engine already refuses non-http(s) redirects; this strips the
 * rest of what a hostile schema could smuggle before it renders on our origin.
 */

import type { Schema } from '@/index.js';

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
const FLAGS = ['allowOther', 'includeTime', 'range', 'showEstimate'];
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
  if ('days' in next) {
    const days = Array.isArray(next.days)
      ? [...new Set((next.days as unknown[]).filter((d): d is string => WEEKDAYS.includes(d as string)))]
      : [];
    if (days.length) next.days = days;
    else delete next.days;
  }
  for (const key of ['startTime', 'endTime']) {
    if (key in next && !(typeof next[key] === 'string' && /^\d{2}:\d{2}$/.test(next[key] as string))) {
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

export function sanitizeUntrustedSchema(schema: Schema): Schema {
  const questions = (schema.questions ?? []).map((q) => {
    const next: Record<string, unknown> = { ...(q as Record<string, unknown>) };
    for (const key of ['title', 'subtitle', 'description', 'placeholder', 'cta', 'label']) {
      if (key in next) next[key] = clampText(next[key]);
    }
    sanitizeOptions(next);
    sanitizeWaveB(next);
    sanitizeWaveC(next);
    if ('redirectUrl' in next) {
      const safe = httpsOnly(next.redirectUrl);
      if (safe) next.redirectUrl = safe;
      else delete next.redirectUrl;
    }
    if (Array.isArray(next.options)) {
      next.options = (next.options as Record<string, unknown>[]).map((opt) => {
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
  const out: Schema = { ...schema, brand, questions };
  if (estimate) out.estimate = estimate;
  else delete out.estimate;
  return out;
}
