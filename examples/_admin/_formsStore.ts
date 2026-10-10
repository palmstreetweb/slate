/**
 * Forms store — persists schemas to localStorage or Neon (ADR-029) with a
 * simple CRUD + pub/sub API. Deleted forms are soft-deleted (`deletedAt`).
 */

import type { Schema } from '@/index.js';
import { isNeonConfigured } from './neon/env.js';
import { isStoresHydrated } from './neon/hydrate.js';
import * as remote from './neon/formsRemote.js';
import { purgeSubmissions } from './_submissionStore.js';
import type { FormQuota } from './formQuota.js';
import { allocateNumericSlug } from './shareUrls.js';

const STORAGE_KEY = 'slate-forms';

export type FormStatus = 'draft' | 'published';

/** A named flyer link: `/forms/{slug}?src={src}` (ADR-063). */
export type TrackedSource = {
  /** What the owner called it, e.g. "Mailbox flyer — Oak St". */
  name: string;
  /** The `src` value in the link: lowercase letters, digits and dashes. */
  src: string;
  createdAt: string;
};

export type FormRecord = {
  id: string;
  name: string;
  /** URL segment for public fill links (`/forms/{slug}`). */
  slug?: string;
  createdAt: string;
  updatedAt: string;
  schema: Schema;
  /** Published snapshot served on public fill links. */
  publishedSchema?: Schema;
  /**
   * The form name as of the last publish: the public title (ADR-061). Cloud: from
   * `forms.published_name`. Undefined when unknown (pre-017 database, old local
   * data), and then a rename is not compared.
   */
  publishedName?: string;
  status?: FormStatus;
  /** ISO timestamp when moved to trash; omitted while active. */
  deletedAt?: string;
  /** Public fill asks for a password first (ADR-043). Cloud only; never the hash. */
  fillLocked?: boolean;
  /**
   * Close settings (ADR-063, migration 019). Live as soon as they're saved — no
   * Republish — because the public lookup and the submit Function read them.
   * `closesAt` is an ISO instant; `maxResponses` counts live (not trashed) responses.
   */
  closesAt?: string;
  maxResponses?: number;
  /** Shown to people who arrive after the form closes (≤ 500 characters). */
  closedMessage?: string;
  /** Share → Tracked links (ADR-063). Studio-only; never served to respondents. */
  trackedSources?: TrackedSource[];
};

/**
 * True when the live link serves an older snapshot than the editor: the schema
 * differs, or the form was renamed since the last publish. A rename with a
 * customized brand name leaves the schema unchanged, so the public title
 * (`publishedName`) is the only place it shows (ADR-061).
 */
export function hasUnpublishedChanges(form: FormRecord | null | undefined): boolean {
  if (!form || form.status !== 'published' || !form.publishedSchema) return false;
  if (form.publishedName !== undefined && form.publishedName !== form.name) return true;
  try {
    return JSON.stringify(form.publishedSchema) !== JSON.stringify(form.schema);
  } catch {
    return true;
  }
}

type Listener = (forms: FormRecord[]) => void;
const listeners = new Set<Listener>();

/** Neon is the source of truth once configured — never fall back to localStorage mid-boot. */
function useNeon(): boolean {
  return isNeonConfigured();
}

/** Mutations require a finished hydrate so we don't write into an empty cache. */
function useRemote(): boolean {
  return isNeonConfigured() && isStoresHydrated();
}

/** When Neon is on but hydrate failed/pending, refuse localStorage writes (split-brain). */
function neonNotReady(): boolean {
  return isNeonConfigured() && !isStoresHydrated();
}

/**
 * Closing and tracked links can be offered (ADR-063). Local mode keeps them on the record.
 * In the cloud they need migration 019's columns, so they only show once a hydrate has read
 * them: a database without 019 never shows a setting it would silently drop or not enforce.
 */
export function supportsCloseSettings(): boolean {
  return !isNeonConfigured() || (isStoresHydrated() && remote.hasCloseColumnsRemote());
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
  if (neonNotReady()) return false;
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
  if (useNeon()) return remote.listFormsRemote();
  return read().filter(isActive);
}

/** All forms including trash (backup export). */
export function listAllForms(): FormRecord[] {
  if (useNeon()) return remote.listAllFormsRemote();
  return read();
}

/** Trashed forms only. */
export function listTrashedForms(): FormRecord[] {
  if (useNeon()) return remote.listTrashedFormsRemote();
  return read().filter(isTrashed);
}

export function countTrashedForms(): number {
  return listTrashedForms().length;
}

export function getForm(formId: string): FormRecord | null {
  if (useNeon()) return remote.getFormRemote(formId);
  return read().find((f) => f.id === formId && isActive(f)) ?? null;
}

/** Cloud quota (ADR-038). `null` in localStorage-only mode (uncapped). */
export function getFormQuota(): FormQuota | null {
  if (!useNeon()) return null;
  return remote.getFormQuotaRemote();
}

export function isAtFormQuota(): boolean {
  const quota = getFormQuota();
  return quota !== null && quota.used >= quota.max;
}

export function createForm(opts: { name: string; schema: Schema }): FormRecord | null {
  if (useRemote()) return remote.createFormRemoteSync(opts);
  if (neonNotReady()) return null;
  const now = new Date().toISOString();
  const existing = read();
  const record: FormRecord = {
    id: id(),
    name: opts.name,
    // Fixed numeric slug at create, same as cloud (ADR-043).
    slug: allocateNumericSlug((c) => existing.some((f) => f.slug === c && isActive(f))),
    createdAt: now,
    updatedAt: now,
    schema: opts.schema,
  };
  return write([record, ...existing]) ? record : null;
}

/** Prefer for New form — waits for Neon upsert so the editor never races a soft refresh. */
export async function createFormAsync(opts: {
  name: string;
  schema: Schema;
}): Promise<FormRecord | null> {
  if (useRemote()) return remote.createFormRemote(opts);
  return createForm(opts);
}

export function updateForm(
  formId: string,
  patch: Partial<Omit<FormRecord, 'id' | 'createdAt'>>,
): [FormRecord | null, boolean] {
  if (useRemote()) return remote.updateFormRemoteSync(formId, patch);
  if (neonNotReady()) return [null, false];
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
  if (neonNotReady()) return false;
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
  if (neonNotReady()) return false;
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
  if (neonNotReady()) return false;
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
  if (neonNotReady()) return false;
  return write(read().filter((f) => f.id !== formId));
}

export function emptyFormTrash(): boolean {
  const trashedIds = listTrashedForms().map((f) => f.id);
  for (const formId of trashedIds) purgeSubmissions(formId);
  if (useRemote()) return remote.emptyFormTrashRemoteSync();
  if (neonNotReady()) return false;
  return write(read().filter(isActive));
}

export function duplicateForm(formId: string): FormRecord | null {
  if (useRemote()) return remote.duplicateFormRemoteSync(formId);
  const src = getForm(formId);
  if (!src) return null;
  return createForm({ name: `${src.name} (Copy)`, schema: src.schema });
}

/** Public-fill password (ADR-043). Cloud only — localStorage mode has no server to enforce it. */
export async function setFormFillPassword(
  formId: string,
  password: string,
): Promise<{ ok: true; locked: boolean } | { ok: false; message: string }> {
  if (!useRemote()) {
    return { ok: false, message: 'Passwords work once you’re signed in to Slate.' };
  }
  return remote.setFormFillPasswordRemote(formId, password);
}

/**
 * Publish the current draft. In the cloud the write lands in the background:
 * `onLanded` runs once it reached the server, `onFail` if it never does, after
 * the form is put back to how it was (COPY-10). "You're live" waits for
 * `onLanded` (STU-5). On this device alone the write is done at once.
 */
export function publishForm(
  formId: string,
  opts: { onFail?: () => void; onLanded?: () => void } = {},
): FormRecord | null {
  if (useRemote()) return remote.publishFormRemoteSync(formId, opts.onFail, opts.onLanded);
  const form = getForm(formId);
  if (!form) return null;
  const [updated, saved] = updateForm(formId, {
    publishedSchema: form.schema,
    publishedName: form.name,
    status: 'published',
  });
  if (updated && saved) opts.onLanded?.();
  else if (updated) opts.onFail?.();
  return updated;
}

/**
 * This form's last change didn't reach the cloud, so it isn't saved yet: the
 * editor sends it again when it opens, and says so until it lands (STU-8).
 */
export function hasUnsavedEdits(formId: string): boolean {
  // Only cloud writes can fail after the fact; this device's own are done at once.
  return remote.hasUnsavedFormEditRemote(formId);
}

export function unpublishForm(formId: string): FormRecord | null {
  if (useRemote()) return remote.unpublishFormRemoteSync(formId);
  const [updated] = updateForm(formId, { status: 'draft' });
  return updated;
}

export function subscribe(listener: Listener): () => void {
  // Always attach to the Neon cache when configured — hydrate notifies these
  // listeners. Gating on isStoresHydrated() caused a sticky empty dashboard:
  // UI subscribed to localStorage, hydrate filled the remote cache, nobody updated.
  if (useNeon()) return remote.subscribeFormsRemote(listener);
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
