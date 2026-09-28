import type { Schema } from '@/index.js';
import type { FormRecord } from '../_formsStore.js';
import type { StoredSubmission } from '../_submissionStore.js';
import type { DbFormRow, DbSubmissionRow, PublishedFormPayload } from './database.types.js';
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
  };
}

/**
 * `get_form_by_slug` row → public payload (ADR-043). Fails closed: a locked
 * row never carries a schema, and an unlocked row without one is unavailable.
 */
export function slugRowToPublishedForm(row: {
  id: string;
  name: string;
  slug: string;
  locked?: boolean | null;
  schema?: unknown;
}): PublishedFormPayload | null {
  const base = { id: row.id, name: row.name, slug: row.slug };
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
  opts: { publishedName?: boolean } = {},
): Pick<
  DbFormRow,
  'id' | 'name' | 'slug' | 'schema' | 'published_schema' | 'status' | 'deleted_at'
> &
  Partial<Pick<DbFormRow, 'published_name'>> {
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
