/**
 * Neon-backed forms cache + persistence (ADR-029).
 */

import type { Schema } from '@/index.js';
import type { FormRecord } from '../_formsStore.js';
import { allocateNumericSlug, slugify } from '../shareUrls.js';
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
import { FORM_OWNER_COLUMNS, type DbFormRow } from './database.types.js';

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

  // Explicit columns, never `*` — `fill_password_hash` must not reach the browser (ADR-043).
  const fetchForms = async (): Promise<DbFormRow[]> => {
    const run = (columns: string) =>
      neon.from('forms').select(columns).order('updated_at', { ascending: false });
    let { data, error } = await run(FORM_OWNER_COLUMNS);
    if (error && isMissingColumnError(error)) {
      // Migration 012 / schema cache not applied yet — library must still load.
      ({ data, error } = await run(FORM_OWNER_COLUMNS.replace(',fill_locked', '')));
    }
    if (error) throw error;
    return (data ?? []) as DbFormRow[];
  };

  let rows = await fetchForms();

  // An empty first load is where a token race shows up: the read ran as the
  // anonymous role, RLS returned nothing, and the dashboard said "no forms"
  // until a refresh (owner report, 2026-09-23). Confirm who the database sees
  // before believing it; a transient error here makes the boot hydrate retry.
  if (rows.length === 0 && cache.length === 0 && opts?.soft) {
    const { data: uid } = await neon.rpc('auth_uid');
    if (typeof uid !== 'string' || !uid) {
      throw new Error('No auth session — cannot load forms.');
    }
    rows = await fetchForms();
  }

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
  // The cap only moves on create/delete; polling it every refresh was a third request per tick.
  if (!opts?.soft) await refreshFormQuota();
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

function isMissingColumnError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === '42703' || e?.code === 'PGRST204' || /fill_locked/.test(e?.message ?? '');
}

/** Fixed 8-digit public slug, allocated once at create (ADR-043). */
function newFormSlug(): string {
  return allocateNumericSlug((candidate) =>
    read().some((f) => f.slug === candidate && isActive(f)),
  );
}

/**
 * Turn the fill password on / change it (`password`) or off (`''`).
 * Goes through the owner-checked RPC — the Data API cannot write the hash.
 */
export async function setFormFillPasswordRemote(
  formId: string,
  password: string,
): Promise<{ ok: true; locked: boolean } | { ok: false; message: string }> {
  try {
    await ensureAuthForDataApi();
    const { data, error } = await getNeon().rpc('set_form_fill_password', {
      p_form_id: formId,
      p_password: password,
    });
    if (error) throw error;
    const locked = data === true;
    cache = read().map((f) => {
      if (f.id !== formId) return f;
      const { fillLocked: _drop, ...rest } = f;
      return locked ? { ...rest, fillLocked: true } : rest;
    });
    // A queued editor save carries its own snapshot — keep the flag in step.
    const queued = queuedFormWrite.get(formId);
    if (queued) {
      const { fillLocked: _drop, ...rest } = queued;
      queuedFormWrite.set(formId, locked ? { ...rest, fillLocked: true } : rest);
    }
    notify();
    return { ok: true, locked };
  } catch (err) {
    const raw = (err as { message?: string } | null)?.message ?? '';
    if (/FILL_PASSWORD_LENGTH/.test(raw)) {
      return { ok: false, message: 'Use 4 to 72 characters.' };
    }
    if ((err as { code?: string } | null)?.code === 'PGRST202') {
      // Migration 012 applied but the Data API schema cache is stale (or 012 is missing).
      return { ok: false, message: 'Password lock isn’t switched on for this workspace yet.' };
    }
    return { ok: false, message: formatNeonError(err, 'Could not update the password.') };
  }
}

/** Only for a caller-supplied slug on a row that has none yet. */
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

/**
 * The database won't take this slug for a new form: another form holds it
 * (live or trashed), a permanent delete retired it, or it isn't a valid new
 * slug (ADR-057). All of these mean "draw again".
 */
function isSlugTakenError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; details?: string } | null;
  return (
    (e?.code === '23505' || e?.code === '23514') &&
    /slug/i.test(`${e.message ?? ''} ${e.details ?? ''}`)
  );
}

/**
 * Insert a new row. Slugs are unique across every owner and never reused,
 * and the local cache only knows this owner's forms — so on a slug clash,
 * draw again. Returns the slug that actually landed.
 */
async function insertForm(form: FormRecord): Promise<string> {
  await ensureAuthForDataApi();
  let slug = form.slug ?? newFormSlug();

  const writeOnce = async () => {
    const neon = getNeon();
    const row = formRecordToRow({ ...form, slug });
    const { error } = await neon.from('forms').insert({
      ...row,
      created_at: form.createdAt,
      updated_at: form.updatedAt,
    });
    if (error) throw error;
  };

  const write = async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await writeOnce();
        return;
      } catch (err) {
        if (!isSlugTakenError(err) || attempt >= 4) throw err;
        slug = newFormSlug();
      }
    }
  };

  try {
    await write();
  } catch (err) {
    if (isQuotaExceededError(err)) throw err;
    if (!isRlsOrAuthError(err)) throw err;
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new Error('Could not save — session expired. Sign out and back in, then try again.');
    }
    await write();
  }
  return slug;
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
      throw new Error('Could not save — session expired. Sign out and back in, then try again.');
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
    window.dispatchEvent(new CustomEvent('slate-persist-error', { detail: { kind, message } }));
  }
}

function emitPersistOk(kind: 'form' | 'submission'): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('slate-persist-ok', { detail: { kind } }));
  }
}

/**
 * `onFail` runs when this exact write fails, so an optimistic change (trash,
 * restore) can be put back instead of looking done while the server disagrees.
 */
function enqueueFormUpsert(form: FormRecord, onFail?: () => void): void {
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
          if (latest === form) onFail?.();
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
  // Already reported via slate-persist-error; the chain stays rejected for awaiters.
  next.catch(() => {});
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
        const landedSlug = await insertForm(latest);
        if (landedSlug !== latest.slug) {
          cache = read().map((f) => (f.id === form.id ? { ...f, slug: landedSlug } : f));
          notify();
        }
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
  // Already reported via slate-persist-error; the chain stays rejected for awaiters.
  next.catch(() => {});
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
    slug: newFormSlug(),
    createdAt: now,
    updatedAt: now,
    schema: opts.schema,
    status: 'draft',
  };
  try {
    record.slug = await insertForm(record);
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
    // Slug is fixed at create — renames and patches never move a printed QR (ADR-043).
    slug: prev.slug ?? (patch.slug ? uniqueSlug(patch.slug, formId) : newFormSlug()),
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

/** Restore re-creates rows, so no password survives it — don't claim one does. */
function withoutFillLock(forms: FormRecord[]): FormRecord[] {
  return forms.map(({ fillLocked: _drop, ...rest }) => rest);
}

export async function replaceAllFormsRemote(input: FormRecord[]): Promise<boolean> {
  const forms = withoutFillLock(input);
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
export function createFormRemoteSync(opts: { name: string; schema: Schema }): FormRecord | null {
  if (isAtFormQuotaRemote()) {
    emitPersistError('form', formQuotaUserMessage(getFormQuotaRemote()));
    return null;
  }
  const now = new Date().toISOString();
  const record: FormRecord = {
    id: `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name,
    slug: newFormSlug(),
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
    // Slug is fixed at create — renames and patches never move a printed QR (ADR-043).
    slug: prev.slug ?? (patch.slug ? uniqueSlug(patch.slug, formId) : newFormSlug()),
  };
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
  enqueueFormUpsert(next);
  return [next, true];
}

/** Put `before` back, unless something newer has replaced `after` since. */
function rollbackForm(before: FormRecord, after: FormRecord): void {
  const idx = read().findIndex((f) => f.id === before.id);
  if (idx === -1 || read()[idx] !== after) return;
  const copy = [...read()];
  copy[idx] = before;
  cache = copy;
  notify();
}

export function trashFormRemoteSync(formId: string): boolean {
  const now = new Date().toISOString();
  const idx = read().findIndex((f) => f.id === formId && isActive(f));
  if (idx === -1) return false;
  const before = read()[idx]!;
  const next = { ...before, deletedAt: now, updatedAt: now };
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
  enqueueFormUpsert(next, () => rollbackForm(before, next));
  return true;
}

export function restoreFormRemoteSync(formId: string): boolean {
  const idx = read().findIndex((f) => f.id === formId && isTrashed(f));
  if (idx === -1) return false;
  const before = read()[idx]!;
  const { deletedAt: _r, ...rest } = before;
  const next = { ...rest, updatedAt: new Date().toISOString() };
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
  enqueueFormUpsert(next, () => rollbackForm(before, next));
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

export function replaceAllFormsRemoteSync(input: FormRecord[]): boolean {
  const forms = withoutFillLock(input);
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
