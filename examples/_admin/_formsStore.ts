/**
 * Forms store — persists schemas to localStorage or Supabase (ADR-028) with a
 * simple CRUD + pub/sub API. Deleted forms are soft-deleted (`deletedAt`).
 */

import type { Schema } from '@/index.js';
import { isSupabaseConfigured } from './supabase/env.js';
import { isStoresHydrated } from './supabase/hydrate.js';
import * as remote from './supabase/formsRemote.js';
import { purgeSubmissions } from './_submissionStore.js';

const STORAGE_KEY = 'slate-forms';

export type FormStatus = 'draft' | 'published';

export type FormRecord = {
  id: string;
  name: string;
  /** URL segment for public fill links (`#/f/{slug}`). */
  slug?: string;
  createdAt: string;
  updatedAt: string;
  schema: Schema;
  /** Published snapshot served on public fill links. */
  publishedSchema?: Schema;
  status?: FormStatus;
  /** ISO timestamp when moved to trash; omitted while active. */
  deletedAt?: string;
};

type Listener = (forms: FormRecord[]) => void;
const listeners = new Set<Listener>();

function useRemote(): boolean {
  return isSupabaseConfigured() && isStoresHydrated();
}

function read(): FormRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isActive(form: FormRecord): boolean {
  return !form.deletedAt;
}

function isTrashed(form: FormRecord): boolean {
  return Boolean(form.deletedAt);
}

/** Probe whether stored forms JSON is unreadable (without mutating). */
export function probeFormsStorage(): 'ok' | 'corrupt' {
  if (useRemote()) return remote.probeFormsRemote();
  if (typeof window === 'undefined') return 'ok';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'ok';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? 'ok' : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

export function resetFormsStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored
  }
  listeners.forEach((l) => l([]));
}

/** Replace all stored forms (backup restore). Returns false on write failure. */
export function replaceAllForms(forms: FormRecord[]): boolean {
  if (useRemote()) return remote.replaceAllFormsRemoteSync(forms);
  return write(forms);
}

function write(forms: FormRecord[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(forms));
    listeners.forEach((l) => l(forms));
    return true;
  } catch {
    return false;
  }
}

function id(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function trashAt(): string {
  return new Date().toISOString();
}

/** Active forms only (not in trash). */
export function listForms(): FormRecord[] {
  if (useRemote()) return remote.listFormsRemote();
  return read().filter(isActive);
}

/** All forms including trash (backup export). */
export function listAllForms(): FormRecord[] {
  if (useRemote()) return remote.listAllFormsRemote();
  return read();
}

/** Trashed forms only. */
export function listTrashedForms(): FormRecord[] {
  if (useRemote()) return remote.listTrashedFormsRemote();
  return read().filter(isTrashed);
}

export function countTrashedForms(): number {
  return listTrashedForms().length;
}

export function getForm(formId: string): FormRecord | null {
  if (useRemote()) return remote.getFormRemote(formId);
  return read().find((f) => f.id === formId && isActive(f)) ?? null;
}

export function createForm(opts: { name: string; schema: Schema }): FormRecord | null {
  if (useRemote()) return remote.createFormRemoteSync(opts);
  const now = new Date().toISOString();
  const record: FormRecord = {
    id: id(),
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    schema: opts.schema,
  };
  return write([record, ...read()]) ? record : null;
}

export function updateForm(
  formId: string,
  patch: Partial<Omit<FormRecord, 'id' | 'createdAt'>>,
): [FormRecord | null, boolean] {
  if (useRemote()) return remote.updateFormRemoteSync(formId, patch);
  const all = read();
  const idx = all.findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return [null, false];
  const next: FormRecord = {
    ...all[idx]!,
    ...patch,
    id: all[idx]!.id,
    createdAt: all[idx]!.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const copy = [...all];
  copy[idx] = next;
  return [next, write(copy)];
}

export function trashForm(formId: string): boolean {
  if (useRemote()) return remote.trashFormRemoteSync(formId);
  const now = trashAt();
  const all = read();
  const idx = all.findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return false;
  const copy = [...all];
  copy[idx] = { ...copy[idx]!, deletedAt: now };
  return write(copy);
}

/** @deprecated Use trashForm */
export function deleteForm(formId: string): boolean {
  return trashForm(formId);
}

export function restoreForm(formId: string): boolean {
  if (useRemote()) return remote.restoreFormRemoteSync(formId);
  const all = read();
  const idx = all.findIndex((f) => f.id === formId && isTrashed(f));
  if (idx === -1) return false;
  const { deletedAt: _removed, ...rest } = all[idx]!;
  const copy = [...all];
  copy[idx] = { ...rest, updatedAt: new Date().toISOString() };
  return write(copy);
}

export function restoreAllForms(): boolean {
  if (useRemote()) return remote.restoreAllFormsRemoteSync();
  return write(
    read().map((f) => {
      if (!isTrashed(f)) return f;
      const { deletedAt: _removed, ...rest } = f;
      return { ...rest, updatedAt: new Date().toISOString() };
    }),
  );
}

export function permanentlyDeleteForm(formId: string): boolean {
  purgeSubmissions(formId);
  if (useRemote()) return remote.permanentlyDeleteFormRemoteSync(formId);
  return write(read().filter((f) => f.id !== formId));
}

export function emptyFormTrash(): boolean {
  const trashedIds = listTrashedForms().map((f) => f.id);
  for (const formId of trashedIds) purgeSubmissions(formId);
  if (useRemote()) return remote.emptyFormTrashRemoteSync();
  return write(read().filter(isActive));
}

export function duplicateForm(formId: string): FormRecord | null {
  if (useRemote()) return remote.duplicateFormRemoteSync(formId);
  const src = getForm(formId);
  if (!src) return null;
  return createForm({ name: `${src.name} (Copy)`, schema: src.schema });
}

export function publishForm(formId: string): FormRecord | null {
  if (useRemote()) return remote.publishFormRemoteSync(formId);
  const form = getForm(formId);
  if (!form) return null;
  const [updated] = updateForm(formId, { publishedSchema: form.schema, status: 'published' });
  return updated;
}

export function unpublishForm(formId: string): FormRecord | null {
  if (useRemote()) return remote.unpublishFormRemoteSync(formId);
  const [updated] = updateForm(formId, { status: 'draft' });
  return updated;
}

export function subscribe(listener: Listener): () => void {
  if (useRemote()) return remote.subscribeFormsRemote(listener);
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener(read());
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * Seed the store with starter forms if it's empty. Idempotent — calling
 * twice doesn't duplicate.
 */
export function seedIfEmpty(seeds: ReadonlyArray<{ name: string; schema: Schema }>): void {
  if (listForms().length > 0 || listTrashedForms().length > 0) return;
  const now = new Date().toISOString();
  const records: FormRecord[] = seeds.map((s, i) => ({
    id: `seed_${i}_${Date.now().toString(36)}`,
    name: s.name,
    createdAt: now,
    updatedAt: now,
    schema: s.schema,
    status: 'draft' as const,
  }));
  if (useRemote()) {
    remote.replaceAllFormsRemoteSync(records);
    return;
  }
  write(records);
}
