/**
 * Public fill's form fetch, without the Neon SDK (ADR-048).
 *
 * Two plain requests: an anonymous JWT from Neon Auth, then the
 * `get_form_by_slug` RPC on the Data API. The SDK's path added a
 * `get-session` round trip first (0.6–2 s measured) and ~100 KB of code a
 * respondent never needs. The app entry calls `loadPublishedForm` before the
 * public chunk has even downloaded, so the network and the JS race in parallel.
 */

import type { PublishedFormPayload } from './database.types.js';
import { deriveNeonServiceUrls, getNeonUrl } from './config.js';
import { slugRowToPublishedForm } from './mappers.js';

const TOKEN_KEY = 'slate-anon-token';
/** Refresh a little early so a token never expires mid-request. */
const TOKEN_SKEW_MS = 60_000;

type CachedToken = { token: string; exp: number };

let memoryToken: CachedToken | null = null;
const inflight = new Map<string, Promise<PublishedFormPayload | null>>();

function urls(): { authUrl: string; dataApiUrl: string } {
  const base = getNeonUrl();
  if (!base) throw new Error('This form is not available right now.');
  return deriveNeonServiceUrls(base);
}

function tokenExp(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function readCachedToken(): string | null {
  const now = Date.now() + TOKEN_SKEW_MS;
  if (memoryToken && memoryToken.exp > now) return memoryToken.token;
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (parsed?.token && parsed.exp > now) {
      memoryToken = parsed;
      return parsed.token;
    }
  } catch {
    /* storage off */
  }
  return null;
}

function writeCachedToken(token: string): void {
  const entry = { token, exp: tokenExp(token) };
  memoryToken = entry;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(entry));
  } catch {
    /* storage off */
  }
}

function dropCachedToken(): void {
  memoryToken = null;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage off */
  }
}

/** Short-lived anonymous JWT (role `anonymous`). Only authorizes public RPCs. */
async function anonymousToken(): Promise<string> {
  const cached = readCachedToken();
  if (cached) return cached;
  const res = await fetch(`${urls().authUrl}/token/anonymous`, { credentials: 'omit' });
  if (!res.ok) throw new Error('Could not load this form. Check your connection and try again.');
  const body = (await res.json()) as { token?: string };
  if (!body.token)
    throw new Error('Could not load this form. Check your connection and try again.');
  writeCachedToken(body.token);
  return body.token;
}

async function rpc<T>(fn: string, args: Record<string, unknown>, retried = false): Promise<T> {
  const token = await anonymousToken();
  const res = await fetch(`${urls().dataApiUrl}/rpc/${fn}`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });
  if (res.status === 401 && !retried) {
    // Token expired or rotated between cache and use — fetch a fresh one once.
    dropCachedToken();
    return rpc<T>(fn, args, true);
  }
  if (!res.ok) throw new Error('Could not load this form. Please try again in a moment.');
  return (await res.json()) as T;
}

async function fetchBySlug(slug: string): Promise<PublishedFormPayload | null> {
  const rows = await rpc<unknown>('get_form_by_slug', { p_slug: slug });
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const row = list[0] as Parameters<typeof slugRowToPublishedForm>[0] | undefined;
  return row ? slugRowToPublishedForm(row) : null;
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
