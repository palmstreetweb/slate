import type { Schema } from '@/index.js';
import type { FormRecord, TrackedSource } from '../_formsStore.js';
import type { StoredSubmission } from '../_submissionStore.js';
import type {
  DbFormRow,
  DbSubmissionRow,
  FormClosedInfo,
  PublishedFormPayload,
} from './database.types.js';
import { normalizeAnswers, normalizeMeta } from '../answerShape.js';

export function rowToFormRecord(row: DbFormRow): FormRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schema: row.schema,
    deletedAt: row.deleted_at ?? undefined,
    status: row.status,
    publishedSchema: row.published_schema ?? undefined,
    ...(typeof row.published_name === 'string' ? { publishedName: row.published_name } : {}),
    ...(row.fill_locked ? { fillLocked: true } : {}),
    ...(typeof row.closes_at === 'string' ? { closesAt: row.closes_at } : {}),
    ...(typeof row.max_responses === 'number' ? { maxResponses: row.max_responses } : {}),
    ...(typeof row.closed_message === 'string' && row.closed_message
      ? { closedMessage: row.closed_message }
      : {}),
    ...(Array.isArray(row.tracked_sources)
      ? { trackedSources: cleanTrackedSources(row.tracked_sources) }
      : {}),
  };
}

/** Stored tracked links → well-formed entries only (owner-written, but still checked). */
export function cleanTrackedSources(raw: unknown): TrackedSource[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackedSource[] = [];
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const { name, src, createdAt } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof src !== 'string') continue;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(src) || src.length > 60) continue;
    out.push({
      name: name.slice(0, 80),
      src,
      createdAt: typeof createdAt === 'string' ? createdAt : '',
    });
  }
  return out;
}

/**
 * `get_form_by_slug` row → public payload (ADR-043). Fails closed: a locked
 * row never carries a schema, and an unlocked row without one is unavailable.
 */
/** A lookup's `closed` field (ADR-063), or null when absent or malformed. */
export function closedInfoOf(raw: unknown): FormClosedInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const { reason, message } = raw as { reason?: unknown; message?: unknown };
  if (reason !== 'date' && reason !== 'full') return null;
  return { reason, message: typeof message === 'string' && message ? message.slice(0, 500) : null };
}

export function slugRowToPublishedForm(row: {
  id: string;
  name: string;
  slug: string;
  locked?: boolean | null;
  schema?: unknown;
  closed?: unknown;
}): PublishedFormPayload | null {
  const base = { id: row.id, name: row.name, slug: row.slug };
  // Closed wins over everything (ADR-063): no schema, no password gate.
  const closed = closedInfoOf(row.closed);
  if (closed) return { ...base, locked: Boolean(row.locked), schema: null, closed };
  if (row.locked) return { ...base, locked: true, schema: null };
  if (!row.schema) return null;
  return { ...base, locked: false, schema: row.schema as Schema };
}

/**
 * Record → writable row. `published_name` goes only when the record knows it and
 * the database has the column (`opts.publishedName`, from hydrate). The trigger
 * keeps it unless it equals `name` on a live row, so ordinary saves (which re-send
 * the old title) never move the public title; Republish (which sets it to `name`)
 * does (017, ADR-061).
 */
export function formRecordToRow(
  form: FormRecord,
  opts: { publishedName?: boolean; closeColumns?: boolean } = {},
): Pick<
  DbFormRow,
  'id' | 'name' | 'slug' | 'schema' | 'published_schema' | 'status' | 'deleted_at'
> &
  Partial<
    Pick<
      DbFormRow,
      'published_name' | 'closes_at' | 'max_responses' | 'closed_message' | 'tracked_sources'
    >
  > {
  return {
    id: form.id,
    name: form.name,
    slug: form.slug ?? form.id,
    schema: form.schema,
    published_schema: form.publishedSchema ?? null,
    status: form.status ?? 'draft',
    deleted_at: form.deletedAt ?? null,
    ...(opts.publishedName && form.publishedName !== undefined
      ? { published_name: form.publishedName }
      : {}),
    // 019 (ADR-063): only once a hydrate has read the columns, so a database without
    // them (or a stale Data API cache) keeps saving. Undefined clears.
    ...(opts.closeColumns
      ? {
          closes_at: form.closesAt ?? null,
          max_responses: form.maxResponses ?? null,
          closed_message: form.closedMessage ?? null,
          tracked_sources: form.trackedSources?.length ? form.trackedSources : null,
        }
      : {}),
  };
}

export function rowToSubmission(row: DbSubmissionRow): StoredSubmission {
  // Written by anonymous respondents — never trust the stored shape (audit H1).
  return {
    id: row.id,
    formId: row.form_id,
    receivedAt: row.received_at,
    answers: normalizeAnswers(row.answers),
    meta: normalizeMeta(row.meta),
    deletedAt: row.deleted_at ?? undefined,
  };
}

export function submissionToRow(
  sub: StoredSubmission,
): Pick<DbSubmissionRow, 'id' | 'form_id' | 'answers' | 'meta' | 'received_at' | 'deleted_at'> {
  return {
    id: sub.id,
    form_id: sub.formId,
    answers: sub.answers as Record<string, unknown>,
    meta: sub.meta as Record<string, unknown>,
    received_at: sub.receivedAt,
    deleted_at: sub.deletedAt ?? null,
  };
}

export function schemaForPublicFill(row: DbFormRow): Schema | null {
  if (row.status === 'published' && row.published_schema) {
    return row.published_schema;
  }
  return null;
}
