/**
 * Public fill's form fetch, without the Neon SDK (ADR-048, ADR-061).
 *
 * One plain GET to the submitresponse Function: `?op=form&slug=`. No custom
 * headers, so it is a CORS "simple" request with no preflight: a first-time
 * QR scan is one round trip. (It was an anonymous token, a preflight and the
 * `get_form_by_slug` RPC.) The Function sees the client IP, which the Data API
 * can't, so unknown-slug lookups are throttled there (ADR-061). The app entry
 * calls `loadPublishedForm` before the public chunk has even downloaded, so the
 * network and the JS race in parallel.
 */

import type { PublishedFormPayload } from './database.types.js';
import { getSubmitUrl } from './config.js';
import { slugRowToPublishedForm } from './mappers.js';

const inflight = new Map<string, Promise<PublishedFormPayload | null>>();

const UNAVAILABLE = 'This form is not available right now.';
const RETRY_LATER = 'Could not load this form. Please try again in a moment.';

function lookupUrl(slug: string): string {
  let base: string;
  try {
    base = getSubmitUrl();
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const u = new URL(base);
  u.searchParams.set('op', 'form');
  u.searchParams.set('slug', slug);
  return u.href;
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `about ${m} minute${m === 1 ? '' : 's'}`;
}

type Row = Parameters<typeof slugRowToPublishedForm>[0];

function isRow(v: unknown): v is Row {
  const r = v as Partial<Row> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.slug === 'string'
  );
}

async function fetchBySlug(slug: string): Promise<PublishedFormPayload | null> {
  let res: Response;
  try {
    // Nothing but the URL: any custom header would add a preflight. The Function
    // answers Cache-Control: no-store, so a republish shows on the next load.
    res = await fetch(lookupUrl(slug), { credentials: 'omit' });
  } catch (err) {
    if (err instanceof Error && err.message === UNAVAILABLE) throw err;
    throw new Error('Could not load this form. Check your connection and try again.');
  }
  if (res.status === 404) return null;
  if (res.status === 429) {
    // Over this network's miss budget (ADR-061): show the server's copy, which names the wait.
    const b = (await res.json().catch(() => ({}))) as {
      error?: unknown;
      retryAfterSeconds?: unknown;
    };
    const wait = Number(b.retryAfterSeconds) || Number(res.headers.get('Retry-After')) || 600;
    throw new Error(
      typeof b.error === 'string' && b.error.startsWith('Too many')
        ? b.error
        : `Too many form links were opened from this network just now. Please try again in ${minutes(wait)}, or switch to mobile data.`,
    );
  }
  if (!res.ok) throw new Error(RETRY_LATER);
  const body: unknown = await res.json().catch(() => null);
  if (!isRow(body)) throw new Error(RETRY_LATER);
  return slugRowToPublishedForm(body);
}

/**
 * Memoized per slug: the entry starts it, PublicFill awaits the same promise.
 * A failure clears the memo so the next call retries.
 */
export function loadPublishedForm(slug: string): Promise<PublishedFormPayload | null> {
  const hit = inflight.get(slug);
  if (hit) return hit;
  const p = fetchBySlug(slug).catch((err: unknown) => {
    inflight.delete(slug);
    throw err;
  });
  inflight.set(slug, p);
  return p;
}
