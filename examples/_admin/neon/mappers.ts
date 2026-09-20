import type { Schema } from '@/index.js';
import type { FormRecord } from '../_formsStore.js';
import type { StoredSubmission } from '../_submissionStore.js';
import type { DbFormRow, DbSubmissionRow } from './database.types.js';

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
  };
}

export function formRecordToRow(
  form: FormRecord,
): Pick<DbFormRow, 'id' | 'name' | 'slug' | 'schema' | 'published_schema' | 'status' | 'deleted_at'> {
  return {
    id: form.id,
    name: form.name,
    slug: form.slug ?? form.id,
    schema: form.schema,
    published_schema: form.publishedSchema ?? null,
    status: form.status ?? 'draft',
    deleted_at: form.deletedAt ?? null,
  };
}

export function rowToSubmission(row: DbSubmissionRow): StoredSubmission {
  const meta = row.meta as StoredSubmission['meta'];
  return {
    id: row.id,
    formId: row.form_id,
    receivedAt: row.received_at,
    answers: row.answers as StoredSubmission['answers'],
    meta,
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
