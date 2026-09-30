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
};
const FLAGS = ['allowOther', 'includeTime', 'range'];

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
        return o;
      });
    }
    return next as unknown as Schema['questions'][number];
  });
  const brand = { ...schema.brand, name: clampText(schema.brand?.name ?? '') };
  if ('logo' in brand) delete (brand as Record<string, unknown>).logo;
  return { ...schema, brand, questions };
}
