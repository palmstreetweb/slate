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

/**
 * Fixed public slug for a new form: 8 random digits, never the form name, so a
 * rename can't move a printed QR (ADR-043). `isTaken` checks active forms;
 * redraw until free. Older word slugs are left alone.
 */
export function allocateNumericSlug(
  isTaken: (candidate: string) => boolean,
  random: () => number = secureRandom,
): string {
  for (;;) {
    // 10000000–99999999: always 8 digits, never a leading zero.
    const candidate = String(10_000_000 + Math.floor(random() * 90_000_000));
    if (!isTaken(candidate)) return candidate;
  }
}

function secureRandom(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
  }
  return Math.random();
}

export function resolveFormSlug(opts: { slug?: string; name: string; id: string }): string {
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

/** Text that is safe inside a double- or single-quoted HTML attribute. */
function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Paste-anywhere iframe for a published form (ADR-054). `?embed=1` drops the
 * page's footer line and posts `{ type: 'slate:height', height }` to the host
 * page so its own script can size the frame. The form name is only a title.
 */
export function buildEmbedSnippet(publicUrl: string, formName: string): string {
  const src = escapeHtmlAttr(`${publicUrl}${publicUrl.includes('?') ? '&' : '?'}embed=1`);
  const title = escapeHtmlAttr(formName.trim() || 'Form');
  return `<iframe src="${src}" title="${title}" style="width:100%;min-height:560px;border:0" loading="lazy"></iframe>`;
}

/** Hash-route preview — schema from localStorage on this device only. */
export function buildDevPreviewUrl(formId: string): string {
  if (typeof window === 'undefined') return hrefFor(`/forms/${formId}/preview`);
  const path = hrefFor(`/forms/${formId}/preview`);
  return `${window.location.origin}${path}`;
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

/** Copy a PNG (data URL or blob URL) to the clipboard as an image. */
export async function copyImage(src: string): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false;
  }
  try {
    const blob = await (await fetch(src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}
