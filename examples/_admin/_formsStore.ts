/**
 * Forms store — persists schemas to localStorage with a simple CRUD +
 * pub/sub API. Drop-in replaceable with a fetch-based backend later
 * (the `seedIfEmpty` + `subscribe` lifecycle stays the same).
 */

import type { Schema } from '@/index.js';

const STORAGE_KEY = 'psw-studio-forms';

export type FormRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  schema: Schema;
};

type Listener = (forms: FormRecord[]) => void;
const listeners = new Set<Listener>();

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

function write(forms: FormRecord[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(forms));
  } catch {
    // ignored
  }
  listeners.forEach((l) => l(forms));
}

function id(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function listForms(): FormRecord[] {
  return read();
}

export function getForm(formId: string): FormRecord | null {
  return read().find((f) => f.id === formId) ?? null;
}

export function createForm(opts: { name: string; schema: Schema }): FormRecord {
  const now = new Date().toISOString();
  const record: FormRecord = {
    id: id(),
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    schema: opts.schema,
  };
  write([record, ...read()]);
  return record;
}

export function updateForm(formId: string, patch: Partial<Omit<FormRecord, 'id' | 'createdAt'>>): FormRecord | null {
  const all = read();
  const idx = all.findIndex((f) => f.id === formId);
  if (idx === -1) return null;
  const next: FormRecord = {
    ...all[idx]!,
    ...patch,
    id: all[idx]!.id,
    createdAt: all[idx]!.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const copy = [...all];
  copy[idx] = next;
  write(copy);
  return next;
}

export function deleteForm(formId: string): void {
  write(read().filter((f) => f.id !== formId));
}

export function duplicateForm(formId: string): FormRecord | null {
  const src = getForm(formId);
  if (!src) return null;
  return createForm({ name: `${src.name} (copy)`, schema: src.schema });
}

export function subscribe(listener: Listener): () => void {
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
  if (read().length > 0) return;
  const now = new Date().toISOString();
  const records: FormRecord[] = seeds.map((s, i) => ({
    id: `seed_${i}_${Date.now().toString(36)}`,
    name: s.name,
    createdAt: now,
    updatedAt: now,
    schema: s.schema,
  }));
  write(records);
}
