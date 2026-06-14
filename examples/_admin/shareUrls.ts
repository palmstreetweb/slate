/**
 * Share-link helpers for Slate. Public URLs require `VITE_PUBLIC_FORM_BASE`
 * (see `.env.example`). Dev preview always uses the hash router on the
 * current origin — localStorage-backed, same-browser only.
 */

import { hrefFor } from './_router.js';

/** Turn a form name into a URL-safe slug segment. */
export function slugify(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return s || 'form';
}

export function resolveFormSlug(opts: {
  slug?: string;
  name: string;
  id: string;
}): string {
  const custom = opts.slug?.trim();
  if (custom) return slugify(custom);
  const fromName = slugify(opts.name);
  if (fromName !== 'form') return fromName;
  return opts.id;
}

/** Configured production base, e.g. `https://805sealcoating.com/quote`. */
export function getPublicFormBase(): string | null {
  const raw = import.meta.env.VITE_PUBLIC_FORM_BASE as string | undefined;
  if (!raw?.trim()) return null;
  return raw.trim().replace(/\/+$/, '');
}

export function buildPublicShareUrl(slug: string): string | null {
  const base = getPublicFormBase();
  if (!base) return null;
  const segment = slugify(slug);
  return `${base}/${segment}`;
}

/** Primary link shown in Share — live URL when configured, else local preview. */
export function resolvePrimaryShareUrl(
  formId: string,
  slug: string,
  formName: string,
): { url: string; mode: 'public' | 'preview' } {
  const effectiveSlug = resolveFormSlug({ slug, name: formName, id: formId });
  const publicUrl = buildPublicShareUrl(effectiveSlug);
  if (publicUrl) return { url: publicUrl, mode: 'public' };
  return { url: buildDevPreviewUrl(formId), mode: 'preview' };
}

/** Hash-route preview — schema from localStorage on this device only. */
export function buildDevPreviewUrl(formId: string): string {
  if (typeof window === 'undefined') return hrefFor(`/forms/${formId}`);
  const path = hrefFor(`/forms/${formId}`);
  return `${window.location.origin}${window.location.pathname}${path}`;
}

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
