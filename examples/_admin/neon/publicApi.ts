/**
 * Public fill API — published forms + anonymous submit (ADR-029).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { Schema } from '@/index.js';
import { getSubmitUrl, isNeonConfigured } from './config.js';
import { loadPublishedForm } from './publicForm.js';
import type { FormClosedInfo, PublishedFormPayload, SlotsLeftPayload } from './database.types.js';
import { closedInfoOf, slotsLeftOf } from './mappers.js';
import { clearFillUnlockToken, readFillUnlockToken } from '../fillUnlock.js';

/** The form closed (410: past its closing time, 409: at its cap) — ADR-063. */
export class FormClosedError extends Error {
  readonly closed: FormClosedInfo;
  constructor(message: string, closed: FormClosedInfo) {
    super(message);
    this.name = 'FormClosedError';
    this.closed = closed;
  }
}

/**
 * A sign-up slot filled while the respondent was answering (ADR-066): 409 with
 * reason 'slot_full'. Nothing was stored; `slotsLeft` is every slot's fresh
 * count, and `full` names the slots to pick again.
 */
export class SlotFullError extends Error {
  readonly full: ReadonlyArray<{ question: string; slot: string }>;
  readonly slotsLeft: SlotsLeftPayload | undefined;
  constructor(
    message: string,
    full: ReadonlyArray<{ question: string; slot: string }>,
    slotsLeft: SlotsLeftPayload | undefined,
  ) {
    super(message);
    this.name = 'SlotFullError';
    this.full = full;
    this.slotsLeft = slotsLeft;
  }
}

/**
 * A file in the answers couldn't be kept (ADR-067): it expired (unsent for over
 * a day), never finished uploading, or isn't this form's. Nothing was stored;
 * `questions` names where to go back and add it again.
 */
export class FilesRejectedError extends Error {
  readonly questions: ReadonlyArray<string>;
  constructor(message: string, questions: ReadonlyArray<string>) {
    super(message);
    this.name = 'FilesRejectedError';
    this.questions = questions;
  }
}

/** A retry key for one fill (ADR-067): a retried submit returns the response already stored. */
export function newSubmitId(): string | undefined {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fresh spots left for a form's sign-up slots (ADR-066): the same throttled
 * lookup as the form itself (ADR-061), with `part=slots` so the schema isn't
 * sent again. Null when there's nothing to update (locked, closed, gone, or
 * the network failed — the counts the page has stay).
 */
export async function fetchSlotsLeft(slug: string): Promise<SlotsLeftPayload | null> {
  if (!isNeonConfigured()) return null;
  try {
    const u = new URL(getSubmitUrl());
    u.searchParams.set('op', 'form');
    u.searchParams.set('slug', slug);
    u.searchParams.set('part', 'slots');
    const res = await fetch(u.href, { credentials: 'omit' });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { slotsLeft?: unknown } | null;
    return slotsLeftOf(body?.slotsLeft) ?? null;
  } catch {
    return null;
  }
}

/** Published form by slug — SDK-free, shared with the app entry's prefetch (ADR-048). */
export function fetchPublishedFormBySlug(slug: string): Promise<PublishedFormPayload | null> {
  if (!isNeonConfigured()) return Promise.resolve(null);
  return loadPublishedForm(slug);
}

export type UnlockResult =
  | { ok: true; form: Extract<PublishedFormPayload, { locked: false }>; unlockToken: string | null }
  | { ok: false; reason: 'wrong_password' | 'rate_limited' | 'unavailable'; message: string }
  | { ok: false; reason: 'closed'; message: string; closed: FormClosedInfo };

/**
 * Trade a password (or this tab's saved token) for the schema (ADR-043).
 * Same Function URL as submit — discriminated by `op`.
 */
export async function unlockPublicForm(
  slug: string,
  proof: { password: string } | { token: string },
): Promise<UnlockResult> {
  let res: Response;
  try {
    res = await fetch(getSubmitUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'unlock', slug, ...proof }),
    });
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Could not connect. Check your connection and try again.',
    };
  }
  if (res.status === 401) {
    return {
      ok: false,
      reason: 'wrong_password',
      message: 'That password didn’t match. Try again.',
    };
  }
  if (res.status === 429) {
    // The server's copy says what to do (wait, or check the password); show it as sent.
    const b = (await res.json().catch(() => ({}))) as {
      error?: unknown;
      retryAfterSeconds?: unknown;
    };
    const retryAfter = Number(b.retryAfterSeconds) || Number(res.headers.get('Retry-After')) || 60;
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    return {
      ok: false,
      reason: 'rate_limited',
      message:
        typeof b.error === 'string' && b.error.startsWith('Too many')
          ? b.error
          : `Too many tries. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: 'unavailable',
      message:
        res.status === 404
          ? 'This form is no longer available.'
          : 'Something went wrong. Please try again in a moment.',
    };
  }
  const body = (await res.json()) as {
    id?: string;
    name?: string;
    slug?: string;
    schema?: unknown;
    unlockToken?: string;
    closed?: unknown;
    slotsLeft?: unknown;
  };
  const closed = closedInfoOf(body.closed);
  if (closed) {
    return { ok: false, reason: 'closed', message: 'This form is closed.', closed };
  }
  if (!body.id || !body.name || !body.slug || !body.schema) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Something went wrong. Please try again in a moment.',
    };
  }
  const slotsLeft = slotsLeftOf(body.slotsLeft);
  return {
    ok: true,
    form: {
      id: body.id,
      name: body.name,
      slug: body.slug,
      locked: false,
      schema: body.schema as Schema,
      ...(slotsLeft ? { slotsLeft } : {}),
    },
    unlockToken: body.unlockToken ?? null,
  };
}

export type SubmitResponsePayload = {
  formId: string;
  /** One per fill, kept across retries (ADR-067). */
  submitId?: string;
  answers: Answers;
  meta: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    questionsVisited: string[];
    hiddenFields: Record<string, unknown>;
    score?: number;
  };
};

export async function submitPublicResponse(
  payload: SubmitResponsePayload,
): Promise<{ id: string }> {
  const url = getSubmitUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        // Present only after a password unlock in this tab (ADR-043).
        unlockToken: readFillUnlockToken(payload.formId) ?? undefined,
      }),
    });
  } catch {
    // Offline, or a platform 429 without CORS headers: not "Failed to fetch".
    throw new Error(
      'Couldn’t reach Slate. Check your connection and press Retry — your answers are still here.',
    );
  }
  if (!res.ok) {
    if (res.status === 401) {
      // Password was changed or removed mid-fill; the old token is dead.
      clearFillUnlockToken(payload.formId);
      throw new Error('This form’s password changed. Reload the page and enter the new one.');
    }
    if (res.status === 410 || res.status === 409) {
      // Closed since the page loaded (ADR-063): the page swaps to the closed screen.
      const b = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        reason?: unknown;
        message?: unknown;
        full?: unknown;
        slotsLeft?: unknown;
      };
      // A sign-up slot filled meanwhile (ADR-066): back to that question, not closed.
      if (res.status === 409 && b.reason === 'slot_full') {
        const full = (Array.isArray(b.full) ? b.full : [])
          .filter(
            (f): f is { question: string; slot: string } =>
              !!f &&
              typeof (f as { question?: unknown }).question === 'string' &&
              typeof (f as { slot?: unknown }).slot === 'string',
          )
          .map((f) => ({ question: f.question, slot: f.slot }));
        throw new SlotFullError(
          typeof b.error === 'string' && b.error
            ? b.error
            : 'A spot you picked just filled up. Please pick another.',
          full,
          slotsLeftOf(b.slotsLeft),
        );
      }
      const closed = closedInfoOf({
        reason: b.reason ?? (res.status === 409 ? 'full' : 'date'),
        message: b.message,
      });
      throw new FormClosedError(
        typeof b.error === 'string' && b.error ? b.error : 'This form is closed.',
        closed ?? { reason: res.status === 409 ? 'full' : 'date', message: null },
      );
    }
    if (res.status === 400) {
      // A file that can't be kept (ADR-067): back to its question, every other answer kept.
      const text = await res.text().catch(() => '');
      let b: { error?: unknown; reason?: unknown; questions?: unknown } = {};
      try {
        b = JSON.parse(text) as typeof b;
      } catch {
        // Plain text: shown as sent below.
      }
      if (b.reason === 'files') {
        throw new FilesRejectedError(
          typeof b.error === 'string' && b.error
            ? b.error
            : 'A file you added expired or didn’t finish uploading. Please remove it and add it again.',
          (Array.isArray(b.questions) ? b.questions : []).filter(
            (q): q is string => typeof q === 'string',
          ),
        );
      }
      throw new Error(text || `Submit failed (${res.status})`);
    }
    if (res.status === 429) {
      let retryAfter = Number(res.headers.get('Retry-After') || 60);
      try {
        const body = (await res.json()) as { error?: string; retryAfterSeconds?: number };
        if (body.retryAfterSeconds) retryAfter = body.retryAfterSeconds;
        throw new Error(
          body.error ||
            `Too many submissions. Please wait about ${retryAfter} seconds and try again.`,
        );
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Too many')) throw err;
        throw new Error(
          `Too many submissions. Please wait about ${retryAfter} seconds and try again.`,
        );
      }
    }
    const text = await res.text();
    throw new Error(text || `Submit failed (${res.status})`);
  }
  return (await res.json()) as { id: string };
}

export function metaToPayload(meta: SubmitMeta): SubmitResponsePayload['meta'] {
  return {
    startedAt: meta.startedAt.toISOString(),
    completedAt: meta.completedAt.toISOString(),
    durationMs: meta.durationMs,
    questionsVisited: meta.questionsVisited,
    hiddenFields: meta.hiddenFields ?? {},
    score: meta.score,
  };
}

export function publicFillUrl(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/forms/${encodeURIComponent(slug)}`;
}
