/**
 * Public fill API — published forms + anonymous submit (ADR-029).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { Schema } from '@/index.js';
import { getNeon, getSubmitUrl, isNeonConfigured } from './env.js';
import { formatNeonError } from './neonError.js';
import type { PublishedFormPayload } from './database.types.js';
import { slugRowToPublishedForm } from './mappers.js';
import { clearFillUnlockToken, readFillUnlockToken } from '../fillUnlock.js';

export async function fetchPublishedFormBySlug(slug: string): Promise<PublishedFormPayload | null> {
  if (!isNeonConfigured()) return null;
  const neon = getNeon();
  const { data, error } = await neon.rpc('get_form_by_slug', { p_slug: slug });
  if (error) {
    throw new Error(formatNeonError(error, 'Could not load this form.'));
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const rows = Array.isArray(data) ? data : [data];
  return slugRowToPublishedForm(rows[0]!);
}

export type UnlockResult =
  | { ok: true; form: Extract<PublishedFormPayload, { locked: false }>; unlockToken: string | null }
  | { ok: false; reason: 'wrong_password' | 'rate_limited' | 'unavailable'; message: string };

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
    const retryAfter = Number(res.headers.get('Retry-After') || 60);
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    return {
      ok: false,
      reason: 'rate_limited',
      message: `Too many tries. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
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
  };
  if (!body.id || !body.name || !body.slug || !body.schema) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Something went wrong. Please try again in a moment.',
    };
  }
  return {
    ok: true,
    form: {
      id: body.id,
      name: body.name,
      slug: body.slug,
      locked: false,
      schema: body.schema as Schema,
    },
    unlockToken: body.unlockToken ?? null,
  };
}

export type SubmitResponsePayload = {
  formId: string;
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      // Present only after a password unlock in this tab (ADR-043).
      unlockToken: readFillUnlockToken(payload.formId) ?? undefined,
    }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      // Password was changed or removed mid-fill; the old token is dead.
      clearFillUnlockToken(payload.formId);
      throw new Error('This form’s password changed. Reload the page and enter the new one.');
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
  return `${origin}/#/f/${encodeURIComponent(slug)}`;
}
