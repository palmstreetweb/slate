/**
 * Public fill API — published forms + anonymous submit (ADR-029).
 *
 * Respondents only ever read the plain sentences in `fillCopy.ts` or the
 * Function's own copy (closed, slot full, files, rate limits). A response body
 * from anything else — a proxy's HTML page, a platform's JSON, a bare status —
 * is logged to the console and never shown (QA pass, COPY-02).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { Schema } from '@/index.js';
import { getSubmitUrl, isNeonConfigured } from './config.js';
import { loadPublishedForm } from './publicForm.js';
import type { FormClosedInfo, PublishedFormPayload, SlotsLeftPayload } from './database.types.js';
import { closedInfoOf, slotsLeftOf } from './mappers.js';
import { clearFillUnlockToken, readFillUnlockToken } from '../fillUnlock.js';
import {
  FORM_UNAVAILABLE,
  GATE_LATER,
  GATE_OFFLINE,
  SEND_LATER,
  SEND_OFFLINE,
  SEND_TOO_LONG,
  WRONG_PASSWORD,
  gateRateLimited,
  sendRateLimited,
} from '../fillCopy.js';

/** The Function's own 404 text on submit: the form was unpublished or deleted. */
const SUBMIT_GONE = 'Form not available';

/** The first 200 characters of a response body, for the console only. */
async function bodySnippet(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text.slice(0, 200);
}

/** The wait a 429 asks for: the body's `retryAfterSeconds`, else the header, else a minute. */
function retryAfterOf(res: Response, body: { retryAfterSeconds?: unknown } | null): number {
  return Number(body?.retryAfterSeconds) || Number(res.headers.get('Retry-After')) || 60;
}

/**
 * 413 (QA pass, GAP-07): the response is over the size limit. Nothing was
 * stored; the page sends the respondent back to their longest answer.
 */
export class TooLongError extends Error {
  constructor() {
    super(SEND_TOO_LONG);
    this.name = 'TooLongError';
  }
}

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
 * The password changed or was removed while the respondent was filling in
 * (401 on submit): this tab's unlock token is dead, so a Retry could only fail
 * again. The page asks for the new password and the answers stay in the tab
 * (audit 2026-10).
 */
export class PasswordChangedError extends Error {
  constructor() {
    super('This form’s password changed. Enter the new one to send your answers.');
    this.name = 'PasswordChangedError';
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
    return { ok: false, reason: 'unavailable', message: GATE_OFFLINE };
  }
  if (res.status === 401) {
    return { ok: false, reason: 'wrong_password', message: WRONG_PASSWORD };
  }
  if (res.status === 429) {
    // The server's copy says what to do (wait, or check the password); show it as sent.
    const b = (await res.json().catch(() => null)) as {
      error?: unknown;
      retryAfterSeconds?: unknown;
    } | null;
    return {
      ok: false,
      reason: 'rate_limited',
      message:
        typeof b?.error === 'string' && b.error.startsWith('Too many')
          ? b.error
          : gateRateLimited(retryAfterOf(res, b)),
    };
  }
  if (!res.ok) {
    console.error('[slate] unlock failed', res.status, await bodySnippet(res));
    return {
      ok: false,
      reason: 'unavailable',
      message: res.status === 404 ? FORM_UNAVAILABLE : GATE_LATER,
    };
  }
  // A captive portal or an edge error page can answer 200 with HTML (COPY-11).
  const body = (await res.json().catch(() => null)) as {
    id?: string;
    name?: string;
    slug?: string;
    schema?: unknown;
    unlockToken?: string;
    closed?: unknown;
    slotsLeft?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    console.error('[slate] unlock: the reply was not JSON');
    return { ok: false, reason: 'unavailable', message: GATE_OFFLINE };
  }
  const closed = closedInfoOf(body.closed);
  if (closed) {
    return { ok: false, reason: 'closed', message: 'This form is closed.', closed };
  }
  if (!body.id || !body.name || !body.slug || !body.schema) {
    return { ok: false, reason: 'unavailable', message: GATE_LATER };
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
    throw new Error(SEND_OFFLINE);
  }
  if (!res.ok) {
    if (res.status === 401) {
      // Password was changed or removed mid-fill; the old token is dead.
      clearFillUnlockToken(payload.formId);
      throw new PasswordChangedError();
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
    const text = await res.text().catch(() => '');
    if (res.status === 400) {
      // A file that can't be kept (ADR-067): back to its question, every other answer kept.
      let b: { error?: unknown; reason?: unknown; questions?: unknown } = {};
      try {
        b = JSON.parse(text) as typeof b;
      } catch {
        // Plain text: not ours to show (below).
      }
      if (b && b.reason === 'files') {
        throw new FilesRejectedError(
          typeof b.error === 'string' && b.error
            ? b.error
            : 'A file you added expired or didn’t finish uploading. Please remove it and add it again.',
          (Array.isArray(b.questions) ? b.questions : []).filter(
            (q): q is string => typeof q === 'string',
          ),
        );
      }
    }
    // Unpublished or deleted while they were answering: the closed screen, no Retry.
    if (res.status === 404 && text.trim() === SUBMIT_GONE) {
      throw new FormClosedError('This form is closed.', { reason: 'date', message: null });
    }
    // Over the body cap (ADR-058): Retry would send the same thing again.
    if (res.status === 413) throw new TooLongError();
    if (res.status === 429) {
      type RateBody = { error?: unknown; retryAfterSeconds?: unknown } | null;
      let b: RateBody = null;
      try {
        b = JSON.parse(text) as RateBody;
      } catch {
        // A platform 429 without the Function's JSON.
      }
      throw new Error(
        typeof b?.error === 'string' && b.error.startsWith('Too many')
          ? b.error
          : sendRateLimited(retryAfterOf(res, b)),
      );
    }
    // A 5xx, a proxy's HTML page, an empty body or an unexpected 400: never shown.
    console.error('[slate] submit failed', res.status, text.slice(0, 200));
    throw new Error(SEND_LATER);
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== 'string') {
    // A 200 that isn't the Function's reply (a captive portal page): it never got there.
    console.error('[slate] submit: the reply was not the Function’s');
    throw new Error(SEND_OFFLINE);
  }
  return { id: body.id };
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
