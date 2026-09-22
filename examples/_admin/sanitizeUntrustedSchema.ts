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

export function sanitizeUntrustedSchema(schema: Schema): Schema {
  const questions = (schema.questions ?? []).map((q) => {
    const next: Record<string, unknown> = { ...(q as Record<string, unknown>) };
    for (const key of ['title', 'subtitle', 'description', 'placeholder', 'cta', 'label']) {
      if (key in next) next[key] = clampText(next[key]);
    }
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
