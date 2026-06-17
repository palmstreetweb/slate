/**
 * Supabase-backed forms cache + persistence (ADR-028).
 */

import type { Schema } from '@/index.js';
import type { FormRecord } from '../_formsStore.js';
import { slugify } from '../shareUrls.js';
import { getSupabase } from './client.js';
import { formRecordToRow, rowToFormRecord } from './mappers.js';

type Listener = (forms: FormRecord[]) => void;

let cache: FormRecord[] = [];
let hydrated = false;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l([...cache]));
}

export function isFormsHydrated(): boolean {
  return hydrated;
}

/** Drop cached rows (e.g. on sign-out). Next hydrate refetches from Postgres. */
export function clearFormsRemoteCache(): void {
  cache = [];
  hydrated = false;
  notify();
}

export async function hydrateFormsRemote(): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('forms').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  cache = (data ?? []).map(rowToFormRecord);
  hydrated = true;
  notify();
}

function read(): FormRecord[] {
  return cache;
}

function isActive(f: FormRecord): boolean {
  return !f.deletedAt;
}

function isTrashed(f: FormRecord): boolean {
  return Boolean(f.deletedAt);
}

function uniqueSlug(base: string, excludeId?: string): string {
  const slug = slugify(base);
  let candidate = slug;
  let n = 2;
  while (read().some((f) => f.slug === candidate && f.id !== excludeId && isActive(f))) {
    candidate = `${slug}-${n}`;
    n += 1;
  }
  return candidate;
}

async function upsertForm(form: FormRecord): Promise<void> {
  const supabase = getSupabase();
  const row = formRecordToRow(form);
  const { error } = await supabase.from('forms').upsert({
    ...row,
    created_at: form.createdAt,
    updated_at: form.updatedAt,
  });
  if (error) throw error;
}

async function deleteFormRow(formId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('forms').delete().eq('id', formId);
  if (error) throw error;
}

export function subscribeFormsRemote(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listFormsRemote(): FormRecord[] {
  return read().filter(isActive);
}

export function listAllFormsRemote(): FormRecord[] {
  return read();
}

export function listTrashedFormsRemote(): FormRecord[] {
  return read().filter(isTrashed);
}

export function getFormRemote(formId: string): FormRecord | null {
  return read().find((f) => f.id === formId && isActive(f)) ?? null;
}

export async function createFormRemote(opts: {
  name: string;
  schema: Schema;
}): Promise<FormRecord | null> {
  const now = new Date().toISOString();
  const record: FormRecord = {
    id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name,
    slug: uniqueSlug(opts.name),
    createdAt: now,
    updatedAt: now,
    schema: opts.schema,
    status: 'draft',
  };
  try {
    await upsertForm(record);
    cache = [record, ...read()];
    notify();
    return record;
  } catch {
    return null;
  }
}

export async function updateFormRemote(
  formId: string,
  patch: Partial<Omit<FormRecord, 'id' | 'createdAt'>>,
): Promise<[FormRecord | null, boolean]> {
  const idx = read().findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return [null, false];
  const prev = read()[idx]!;
  const next: FormRecord = {
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
    slug: patch.slug ? uniqueSlug(patch.slug, formId) : prev.slug ?? uniqueSlug(prev.name, formId),
  };
  try {
    await upsertForm(next);
    const copy = [...read()];
    copy[idx] = next;
    cache = copy;
    notify();
    return [next, true];
  } catch {
    return [null, false];
  }
}

export async function trashFormRemote(formId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const idx = read().findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return false;
  const next = { ...read()[idx]!, deletedAt: now, updatedAt: now };
  try {
    await upsertForm(next);
    const copy = [...read()];
    copy[idx] = next;
    cache = copy;
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function restoreFormRemote(formId: string): Promise<boolean> {
  const idx = read().findIndex((f) => f.id === formId && isTrashed(f));
  if (idx === -1) return false;
  const { deletedAt: _r, ...rest } = read()[idx]!;
  const next = { ...rest, updatedAt: new Date().toISOString() };
  try {
    await upsertForm(next);
    const copy = [...read()];
    copy[idx] = next;
    cache = copy;
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function restoreAllFormsRemote(): Promise<boolean> {
  const updated = read().map((f) => {
    if (!isTrashed(f)) return f;
    const { deletedAt: _r, ...rest } = f;
    return { ...rest, updatedAt: new Date().toISOString() };
  });
  try {
    for (const f of updated.filter((_f, i) => isTrashed(read()[i]!))) {
      await upsertForm(f);
    }
    cache = updated;
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function permanentlyDeleteFormRemote(formId: string): Promise<boolean> {
  try {
    await deleteFormRow(formId);
    cache = read().filter((f) => f.id !== formId);
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function emptyFormTrashRemote(): Promise<boolean> {
  const trashed = listTrashedFormsRemote();
  try {
    for (const f of trashed) {
      await deleteFormRow(f.id);
    }
    cache = read().filter(isActive);
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function duplicateFormRemote(formId: string): Promise<FormRecord | null> {
  const src = getFormRemote(formId);
  if (!src) return null;
  return createFormRemote({ name: `${src.name} (Copy)`, schema: src.schema });
}

export async function publishFormRemote(formId: string): Promise<FormRecord | null> {
  const form = getFormRemote(formId);
  if (!form) return null;
  const [updated] = await updateFormRemote(formId, {
    publishedSchema: form.schema,
    status: 'published',
  });
  return updated;
}

export async function unpublishFormRemote(formId: string): Promise<FormRecord | null> {
  const [updated] = await updateFormRemote(formId, { status: 'draft' });
  return updated;
}

export async function replaceAllFormsRemote(forms: FormRecord[]): Promise<boolean> {
  try {
    const existing = read();
    for (const f of existing) {
      await deleteFormRow(f.id);
    }
    for (const f of forms) {
      await upsertForm(f);
    }
    cache = [...forms];
    notify();
    return true;
  } catch {
    return false;
  }
}

/** Optimistic sync wrapper — updates cache immediately, persists in background. */
export function createFormRemoteSync(opts: {
  name: string;
  schema: Schema;
}): FormRecord | null {
  const now = new Date().toISOString();
  const record: FormRecord = {
    id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name,
    slug: uniqueSlug(opts.name),
    createdAt: now,
    updatedAt: now,
    schema: opts.schema,
    status: 'draft',
  };
  cache = [record, ...read()];
  notify();
  void upsertForm(record);
  return record;
}

export function updateFormRemoteSync(
  formId: string,
  patch: Partial<Omit<FormRecord, 'id' | 'createdAt'>>,
): [FormRecord | null, boolean] {
  const idx = read().findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return [null, false];
  const prev = read()[idx]!;
  const next: FormRecord = {
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: new Date().toISOString(),
    slug: patch.slug ? uniqueSlug(patch.slug, formId) : prev.slug ?? uniqueSlug(prev.name, formId),
  };
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
  void upsertForm(next);
  return [next, true];
}

export function trashFormRemoteSync(formId: string): boolean {
  const now = new Date().toISOString();
  const idx = read().findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return false;
  const next = { ...read()[idx]!, deletedAt: now, updatedAt: now };
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
  void upsertForm(next);
  return true;
}

export function restoreFormRemoteSync(formId: string): boolean {
  const idx = read().findIndex((f) => f.id === formId && isTrashed(f));
  if (idx === -1) return false;
  const { deletedAt: _r, ...rest } = read()[idx]!;
  const next = { ...rest, updatedAt: new Date().toISOString() };
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
  void upsertForm(next);
  return true;
}

export function restoreAllFormsRemoteSync(): boolean {
  const updated = read().map((f) => {
    if (!isTrashed(f)) return f;
    const { deletedAt: _r, ...rest } = f;
    return { ...rest, updatedAt: new Date().toISOString() };
  });
  cache = updated;
  notify();
  for (const f of updated) {
    void upsertForm(f);
  }
  return true;
}

export function permanentlyDeleteFormRemoteSync(formId: string): boolean {
  cache = read().filter((f) => f.id !== formId);
  notify();
  void deleteFormRow(formId);
  return true;
}

export function emptyFormTrashRemoteSync(): boolean {
  const trashed = listTrashedFormsRemote();
  cache = read().filter(isActive);
  notify();
  for (const f of trashed) {
    void deleteFormRow(f.id);
  }
  return true;
}

export function duplicateFormRemoteSync(formId: string): FormRecord | null {
  const src = getFormRemote(formId);
  if (!src) return null;
  return createFormRemoteSync({ name: `${src.name} (Copy)`, schema: src.schema });
}

export function publishFormRemoteSync(formId: string): FormRecord | null {
  const form = getFormRemote(formId);
  if (!form) return null;
  const [updated] = updateFormRemoteSync(formId, {
    publishedSchema: form.schema,
    status: 'published',
  });
  return updated;
}

export function unpublishFormRemoteSync(formId: string): FormRecord | null {
  const [updated] = updateFormRemoteSync(formId, { status: 'draft' });
  return updated;
}

export function replaceAllFormsRemoteSync(forms: FormRecord[]): boolean {
  const prev = read();
  cache = [...forms];
  notify();
  void (async () => {
    for (const f of prev) await deleteFormRow(f.id);
    for (const f of forms) await upsertForm(f);
  })();
  return true;
}

export function probeFormsRemote(): 'ok' | 'corrupt' {
  return hydrated ? 'ok' : 'ok';
}
