/**
 * Flyer source tracking and prefill from the link (ADR-063). Pure helpers.
 *
 * The public link never changes: `/forms/{slug}`. Tracking and prefill are
 * query parameters added on top, so every printed QR keeps working.
 *   - `src` and `utm_*` go to the response's `meta.hiddenFields` (never shown).
 *   - Any other parameter can prefill a question whose owner turned that on
 *     (the engine decides; see src/logic/prefill.ts).
 * Links the studio generates carry `src` only — never an answer.
 */

import type { TrackedSource } from './_formsStore.js';

/** Parameters that tag where a response came from. */
export const TRACKING_PARAMS = [
  'src',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

/** Parameters the fill page uses itself; never a prefill. */
const PAGE_PARAMS = new Set<string>([...TRACKING_PARAMS, 'embed']);

const TRACKING_MAX = 100;
const PREFILL_KEYS_MAX = 30;
const PREFILL_VALUE_MAX = 500;

/** Printable text only, trimmed and capped. */
function clean(value: string, max: number): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, max)
  );
}

/** `src` / `utm_*` from the link → hidden fields for the response. */
export function trackingFromSearch(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TRACKING_PARAMS) {
    const raw = params.get(key);
    if (raw === null) continue;
    const v = clean(raw, TRACKING_MAX);
    if (v) out[key] = v;
  }
  return out;
}

/** Every other parameter, bounded, for `<Form prefill>`. */
export function prefillFromSearch(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, raw] of params) {
    if (n >= PREFILL_KEYS_MAX) break;
    if (PAGE_PARAMS.has(key.toLowerCase()) || !/^[A-Za-z0-9_-]{1,40}$/.test(key)) continue;
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    const v = clean(raw, PREFILL_VALUE_MAX);
    if (!v) continue;
    out[key] = v;
    n += 1;
  }
  return out;
}

/** "Mailbox flyer — Oak St" → "mailbox-flyer-oak-st" (≤ 60 characters). */
export function sourceSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** The public link with `?src=`; the base link is untouched. */
export function trackedLinkUrl(publicUrl: string, src: string): string {
  const u = new URL(publicUrl);
  u.searchParams.set('src', src);
  return u.href;
}

/** Where a response came from: `src`, else `utm_source`, else null ("Direct"). */
export function sourceOf(hiddenFields: Record<string, unknown> | undefined | null): string | null {
  if (!hiddenFields) return null;
  for (const key of ['src', 'utm_source']) {
    const v = hiddenFields[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, TRACKING_MAX);
  }
  return null;
}

/** What to call a source: the owner's name for it, else "mailbox-flyer" → "Mailbox flyer". */
export function sourceLabel(src: string | null, tracked?: ReadonlyArray<TrackedSource>): string {
  if (src === null) return 'Direct';
  const named = tracked?.find((t) => t.src === src);
  if (named) return named.name;
  const words = src.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : src;
}

/** Add a tracked link by name. Returns the new list and the entry, or an error for the owner. */
export function addTrackedSource(
  list: ReadonlyArray<TrackedSource>,
  name: string,
  now: Date = new Date(),
): { list: TrackedSource[]; entry: TrackedSource } | { error: string } {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { error: 'Give it a name, like “Mailbox flyer”.' };
  const src = sourceSlug(trimmed);
  if (!src) return { error: 'Use some letters or numbers in the name.' };
  const existing = list.find((t) => t.src === src);
  if (existing) return { list: [...list], entry: existing };
  if (list.length >= 50) return { error: 'That’s 50 tracked links — remove one first.' };
  const entry = { name: trimmed, src, createdAt: now.toISOString() };
  return { list: [...list, entry], entry };
}
