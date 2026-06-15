/**
 * Public fill API — published forms + anonymous submit (ADR-028).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { Schema } from '@/index.js';
import { getSupabase, getFunctionsUrl, isSupabaseConfigured } from './env.js';
import type { PublishedFormPayload } from './database.types.js';

export async function fetchPublishedFormBySlug(slug: string): Promise<PublishedFormPayload | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_form_by_slug', { p_slug: slug });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
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
  const url = `${getFunctionsUrl()}/submit-response`;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
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
