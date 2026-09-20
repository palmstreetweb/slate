/**
 * Neon-backed forms cache + persistence (ADR-029).
 */

import type { Schema } from '@/index.js';
import type { FormRecord } from '../_formsStore.js';
import { slugify } from '../shareUrls.js';
import { getNeon } from './client.js';
import { ensureAuthForDataApi, waitForAuthReady } from './ensureAuth.js';
import {
  FORM_QUOTA_MAX,
  FormQuotaError,
  formQuotaUserMessage,
  quotaFromUnknown,
  type FormQuota,
} from '../formQuota.js';
import { formatNeonError, isQuotaExceededError, isRlsOrAuthError } from './neonError.js';
import { formRecordToRow, rowToFormRecord } from './mappers.js';

type Listener = (forms: FormRecord[]) => void;

let cache: FormRecord[] = [];
let hydrated = false;
/** Bumped on clear / new hydrate so late fetches can't clobber after sign-out. */
let writeGeneration = 0;
/** Server-reported cap (ADR-038). `used` is always cache length, including trash. */
let quotaMax = FORM_QUOTA_MAX;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l([...cache]));
}

export function isFormsHydrated(): boolean {
  return hydrated;
}

/** Drop cached rows (e.g. on sign-out). Next hydrate refetches from Postgres. */
export function clearFormsRemoteCache(): void {
  writeGeneration += 1;
  queuedFormWrite.clear();
  formWriteChain.clear();
  deletedFormIds.clear();
  cache = [];
  hydrated = false;
  quotaMax = FORM_QUOTA_MAX;
  notify();
}

/** Invalidate in-flight hydrate applies without wiping a warm cache. */
export function bumpFormsRemoteGeneration(): void {
  writeGeneration += 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Load forms from Neon into the in-memory cache.
 * Empty results are valid for new accounts. One short settle retry only when
 * auth uid was missing on the first read — never sleep-loop a known-empty library.
 */
export async function hydrateFormsRemote(opts?: { soft?: boolean }): Promise<void> {
  const gen = writeGeneration;
  await ensureAuthForDataApi();

  const neon = getNeon();

  const fetchForms = async () => {
    const { data, error } = await neon
      .from('forms')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  };

  let rows = await fetchForms();

  // Soft refresh: one shot. Don't re-enter auth settle sleeps on empty.
  if (rows.length === 0 && !opts?.soft) {
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new Error(
        'Signed in, but the database could not resolve your user id from the session. Sign out and back in, then try again.',
      );
    }
    // Auth is confirmed — empty library is normal. One brief refetch only if
    // the first read may have raced token attachment.
    await sleep(150);
    await ensureAuthForDataApi();
    rows = await fetchForms();
  }

  if (gen !== writeGeneration) return;

  const next = rows.map(rowToFormRecord);

  // Soft refresh / race: do not replace a known library with a flaky empty read.
  if (next.length === 0 && cache.length > 0) {
    console.warn(
      '[slate] Empty forms fetch after retries — keeping cached library (%d forms).',
      cache.length,
    );
    hydrated = true;
    return;
  }

  // Merge server rows with in-flight local writes. An optimistic "New form"
  // must survive a soft refresh that raced ahead of the upsert response —
  // otherwise the editor mounts on a cache miss → "Form not found".
  cache = mergeHydratedForms(next);
  hydrated = true;
  await refreshFormQuota();
  if (gen !== writeGeneration) return;
  notify();
}

/** Re-fetch forms without wiping other stores (dashboard focus / recovery). */
export async function refreshFormsRemote(): Promise<void> {
  await hydrateFormsRemote({ soft: true });
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

export function getFormQuotaRemote(): FormQuota {
  return { used: read().length, max: quotaMax };
}

export function isAtFormQuotaRemote(): boolean {
  const { used, max } = getFormQuotaRemote();
  return used >= max;
}

async function refreshFormQuota(): Promise<void> {
  try {
    const neon = getNeon();
    const { data, error } = await neon.rpc('form_quota_status');
    if (error || data == null) return;
    const row = (Array.isArray(data) ? data[0] : data) as { max_forms?: number } | undefined;
    if (typeof row?.max_forms === 'number' && row.max_forms > 0) {
      quotaMax = row.max_forms;
    }
  } catch {
    // Migration / schema cache not ready — keep FORM_QUOTA_MAX.
  }
}

async function insertForm(form: FormRecord): Promise<void> {
  await ensureAuthForDataApi();

  const write = async () => {
    const neon = getNeon();
    const row = formRecordToRow(form);
    const { error } = await neon.from('forms').insert({
      ...row,
      created_at: form.createdAt,
      updated_at: form.updatedAt,
    });
    if (error) throw error;
  };

  try {
    await write();
  } catch (err) {
    if (isQuotaExceededError(err)) throw err;
    if (!isRlsOrAuthError(err)) throw err;
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new Error(
        'Could not save — session expired. Sign out and back in, then try again.',
      );
    }
    await write();
  }
}

async function upsertForm(form: FormRecord): Promise<void> {
  await ensureAuthForDataApi();

  const write = async () => {
    const neon = getNeon();
    const row = formRecordToRow(form);
    const { error } = await neon.from('forms').upsert(
      {
        ...row,
        created_at: form.createdAt,
        updated_at: form.updatedAt,
      },
      { onConflict: 'id' },
    );
    if (error) throw error;
  };

  try {
    await write();
  } catch (err) {
    if (!isRlsOrAuthError(err)) throw err;
    // allowAnonymous can briefly attach an anon JWT while the UI still looks signed-in.
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new Error(
        'Could not save — session expired. Sign out and back in, then try again.',
      );
    }
    await write();
  }
}

async function deleteFormRow(formId: string): Promise<void> {
  await ensureAuthForDataApi();
  const neon = getNeon();
  const { error } = await neon.from('forms').delete().eq('id', formId);
  if (error) throw error;
}

/** Coalesce rapid editor saves so older in-flight upserts can't overwrite newer ones. */
const queuedFormWrite = new Map<string, FormRecord>();
const formWriteChain = new Map<string, Promise<void>>();
/** Form ids with a pending/completed permanent delete — block resurrecting upserts. */
const deletedFormIds = new Set<string>();

/**
 * Server snapshot wins for settled rows; keep optimistic / in-flight locals
 * that have not appeared in the fetch yet (or are newer queued edits).
 */
function mergeHydratedForms(serverRows: FormRecord[]): FormRecord[] {
  const byId = new Map(serverRows.map((f) => [f.id, f]));

  for (const [id, local] of queuedFormWrite) {
    if (deletedFormIds.has(id)) continue;
    byId.set(id, local);
  }

  for (const local of cache) {
    if (deletedFormIds.has(local.id)) continue;
    if (byId.has(local.id)) continue;
    if (queuedFormWrite.has(local.id) || formWriteChain.has(local.id)) {
      byId.set(local.id, local);
    }
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function emitPersistError(kind: 'form' | 'submission', message: string): void {
  console.error(`[slate] ${kind} persist failed:`, message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('slate-persist-error', { detail: { kind, message } }),
    );
  }
}

function emitPersistOk(kind: 'form' | 'submission'): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('slate-persist-ok', { detail: { kind } }));
  }
}

function enqueueFormUpsert(form: FormRecord): void {
  if (deletedFormIds.has(form.id)) return;
  queuedFormWrite.set(form.id, form);
  const prev = formWriteChain.get(form.id) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      /* keep chain alive */
    })
    .then(async () => {
      while (queuedFormWrite.has(form.id)) {
        if (deletedFormIds.has(form.id)) {
          queuedFormWrite.delete(form.id);
          return;
        }
        const latest = queuedFormWrite.get(form.id)!;
        queuedFormWrite.delete(form.id);
        try {
          await upsertForm(latest);
          emitPersistOk('form');
        } catch (err) {
          const message = formatNeonError(err, 'Could not save form');
          emitPersistError('form', message);
          throw err;
        }
      }
    })
    .finally(() => {
      if (formWriteChain.get(form.id) === next) {
        formWriteChain.delete(form.id);
      }
    });
  formWriteChain.set(form.id, next);
}

function dropOptimisticForm(formId: string): void {
  queuedFormWrite.delete(formId);
  cache = read().filter((f) => f.id !== formId);
  notify();
}

/** New form / duplicate — insert only, roll back the optimistic row on quota. */
function enqueueFormInsert(form: FormRecord): void {
  if (deletedFormIds.has(form.id)) return;
  queuedFormWrite.set(form.id, form);
  const prev = formWriteChain.get(form.id) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      /* keep chain alive */
    })
    .then(async () => {
      if (deletedFormIds.has(form.id)) {
        queuedFormWrite.delete(form.id);
        return;
      }
      const latest = queuedFormWrite.get(form.id) ?? form;
      queuedFormWrite.delete(form.id);
      try {
        await insertForm(latest);
        emitPersistOk('form');
      } catch (err) {
        dropOptimisticForm(form.id);
        const message = formatNeonError(err, 'Could not save form');
        emitPersistError('form', message);
        throw err;
      }
    })
    .finally(() => {
      if (formWriteChain.get(form.id) === next) {
        formWriteChain.delete(form.id);
      }
    });
  formWriteChain.set(form.id, next);
}

/** Cancel pending upserts, then delete — prevents soft-delete upsert resurrecting the row. */
function enqueueFormDelete(formId: string, onFailRestore?: FormRecord): void {
  deletedFormIds.add(formId);
  queuedFormWrite.delete(formId);
  const prev = formWriteChain.get(formId) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      /* keep chain alive */
    })
    .then(async () => {
      try {
        await deleteFormRow(formId);
        emitPersistOk('form');
      } catch (err) {
        deletedFormIds.delete(formId);
        const message = formatNeonError(err, 'Could not delete form');
        emitPersistError('form', message);
        if (onFailRestore) {
          cache = [onFailRestore, ...read().filter((f) => f.id !== onFailRestore.id)];
          notify();
        }
        throw err;
      }
    })
    .finally(() => {
      if (formWriteChain.get(formId) === next) {
        formWriteChain.delete(formId);
      }
    });
  formWriteChain.set(formId, next);
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
  if (isAtFormQuotaRemote()) {
    throw new FormQuotaError(getFormQuotaRemote());
  }
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
    await insertForm(record);
    cache = [record, ...read()];
    notify();
    return record;
  } catch (err) {
    if (isQuotaExceededError(err)) {
      throw new FormQuotaError(quotaFromUnknown(err) ?? getFormQuotaRemote());
    }
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
  if (isAtFormQuotaRemote()) {
    emitPersistError('form', formQuotaUserMessage(getFormQuotaRemote()));
    return null;
  }
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
  enqueueFormInsert(record);
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
  enqueueFormUpsert(next);
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
  enqueueFormUpsert(next);
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
  enqueueFormUpsert(next);
  return true;
}

export function restoreAllFormsRemoteSync(): boolean {
  const toRestore: FormRecord[] = [];
  const updated = read().map((f) => {
    if (!isTrashed(f)) return f;
    const { deletedAt: _r, ...rest } = f;
    const next = { ...rest, updatedAt: new Date().toISOString() };
    toRestore.push(next);
    return next;
  });
  cache = updated;
  notify();
  for (const f of toRestore) {
    enqueueFormUpsert(f);
  }
  return true;
}

export function permanentlyDeleteFormRemoteSync(formId: string): boolean {
  const prev = read().find((f) => f.id === formId);
  if (!prev) return false;
  cache = read().filter((f) => f.id !== formId);
  notify();
  enqueueFormDelete(formId, prev);
  return true;
}

export function emptyFormTrashRemoteSync(): boolean {
  const trashed = listTrashedFormsRemote();
  if (trashed.length === 0) return true;
  cache = read().filter(isActive);
  notify();
  for (const f of trashed) {
    enqueueFormDelete(f.id, f);
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
  // Never fire-and-forget a wipe — restore/backup must finish or roll back.
  cache = [...forms];
  notify();
  void (async () => {
    try {
      for (const f of prev) await deleteFormRow(f.id);
      for (const f of forms) await upsertForm(f);
    } catch (err) {
      const message = formatNeonError(err, 'Could not replace forms');
      emitPersistError('form', message);
      try {
        await hydrateFormsRemote();
      } catch {
        cache = prev;
        notify();
      }
    }
  })();
  return true;
}

export function probeFormsRemote(): 'ok' | 'corrupt' {
  return hydrated ? 'ok' : 'ok';
}
