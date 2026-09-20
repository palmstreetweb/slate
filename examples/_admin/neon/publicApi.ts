/**
 * Public fill API — published forms + anonymous submit (ADR-029).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { Schema } from '@/index.js';
import { getNeon, getSubmitUrl, isNeonConfigured } from './env.js';
import { formatNeonError } from './neonError.js';
import type { PublishedFormPayload } from './database.types.js';

export async function fetchPublishedFormBySlug(slug: string): Promise<PublishedFormPayload | null> {
  if (!isNeonConfigured()) return null;
  const neon = getNeon();
  const { data, error } = await neon.rpc('get_form_by_slug', { p_slug: slug });
  if (error) {
    throw new Error(formatNeonError(error, 'Could not load this form.'));
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const rows = Array.isArray(data) ? data : [data];
  const row = rows[0]!;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    schema: row.schema as Schema,
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

export async function submitPublicResponse(payload: SubmitResponsePayload): Promise<{ id: string }> {
  const url = getSubmitUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
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
