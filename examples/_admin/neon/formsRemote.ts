/**
 * Neon-backed forms cache + persistence (ADR-029).
 */

import type { Schema } from '@/index.js';
import type { FormRecord } from '../_formsStore.js';
import { allocateNumericSlug, slugify } from '../shareUrls.js';
import { getNeon } from './client.js';
import { afterPermanentDelete } from './storageQuotaRemote.js';
import { dropFormSubmissionsLocal } from './submissionsRemote.js';
import { ensureAuthForDataApi, waitForAuthReady } from './ensureAuth.js';
import {
  FORM_QUOTA_MAX,
  FormQuotaError,
  formQuotaUserMessage,
  quotaFromUnknown,
  type FormQuota,
} from '../formQuota.js';
import {
  SessionNotReadyError,
  formatNeonError,
  isQuotaExceededError,
  isRlsOrAuthError,
  userNeonError,
  type NeonAction,
} from './neonError.js';
import { formRecordToRow, rowToFormRecord } from './mappers.js';
import {
  FORM_CLOSE_COLUMNS,
  FORM_OPTIONAL_COLUMNS,
  FORM_OWNER_COLUMNS,
  type DbFormRow,
} from './database.types.js';

type Listener = (forms: FormRecord[]) => void;

let cache: FormRecord[] = [];
let hydrated = false;
/** Bumped on clear / new hydrate so late fetches can't clobber after sign-out. */
let writeGeneration = 0;
/** Server-reported cap (ADR-038). `used` is always cache length, including trash. */
let quotaMax = FORM_QUOTA_MAX;
/**
 * The last hydrate read `forms.published_name` (017). Until then writes never carry it,
 * so a database without the column (or a stale Data API cache) keeps saving (ADR-061).
 */
let publishedNameColumn = false;
/** The last hydrate read 019's close columns (ADR-063); until then writes never carry them. */
let closeColumns = false;
const listeners = new Set<Listener>();

/** The database has 019's columns, as of the last hydrate (ADR-063). */
export function hasCloseColumnsRemote(): boolean {
  return closeColumns;
}

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
  queuedWaiters.clear();
  unsavedFormIds.clear();
  formWriteChain.clear();
  deletedFormIds.clear();
  localWriteAt.clear();
  cache = [];
  hydrated = false;
  quotaMax = FORM_QUOTA_MAX;
  publishedNameColumn = false;
  closeColumns = false;
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
  let hasPublishedName = true;
  let hasCloseColumns = true;
  const fetchForms = async (): Promise<DbFormRow[]> => {
    const run = (columns: readonly string[]) =>
      neon.from('forms').select(columns.join(',')).order('updated_at', { ascending: false });
    let columns = FORM_OWNER_COLUMNS.split(',');
    let { data, error } = await run(columns);
    // Migration 012 / 017 or the schema cache not applied yet — the library must still load.
    // Drop the optional column the error names (else the next one) and read again.
    while (error && isMissingColumnError(error)) {
      const message = (error as { message?: string }).message ?? '';
      const optional = FORM_OPTIONAL_COLUMNS.filter((c) => columns.includes(c));
      if (optional.length === 0) break;
      const drop = optional.find((c) => message.includes(c)) ?? optional[0]!;
      columns = columns.filter((c) => c !== drop);
      ({ data, error } = await run(columns));
    }
    if (error) throw error;
    hasPublishedName = columns.includes('published_name');
    hasCloseColumns = FORM_CLOSE_COLUMNS.every((c) => columns.includes(c));
    return (data ?? []) as DbFormRow[];
  };

  // A row the server answers with can predate a save this browser made after the
  // request went out; the merge keeps such a form's local record (audit B1).
  const fetchStartedAt = Date.now();
  let rows = await fetchForms();

  // An empty first load is where a token race shows up: the read ran as the
  // anonymous role, RLS returned nothing, and the dashboard said "no forms"
  // until a refresh (owner report, 2026-09-23). Confirm who the database sees
  // before believing it; a transient error here makes the boot hydrate retry.
  if (rows.length === 0 && cache.length === 0 && opts?.soft) {
    const { data: uid } = await neon.rpc('auth_uid');
    if (typeof uid !== 'string' || !uid) {
      throw new SessionNotReadyError('Slate couldn’t confirm it’s you yet.');
    }
    rows = await fetchForms();
  }

  // Soft refresh: one shot. Don't re-enter auth settle sleeps on empty.
  if (rows.length === 0 && !opts?.soft) {
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new SessionNotReadyError('Slate couldn’t confirm it’s you yet.');
    }
    // Auth is confirmed — empty library is normal. One brief refetch only if
    // the first read may have raced token attachment.
    await sleep(150);
    await ensureAuthForDataApi();
    rows = await fetchForms();
  }

  if (gen !== writeGeneration) return;

  publishedNameColumn = hasPublishedName;
  closeColumns = hasCloseColumns;
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
  cache = mergeHydratedForms(next, fetchStartedAt);
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
  return (
    e?.code === '42703' ||
    e?.code === 'PGRST204' ||
    /fill_locked|published_name|closes_at|max_responses|closed_message|tracked_sources/.test(
      e?.message ?? '',
    )
  );
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
    touchLocal(formId);
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
      return { ok: false, message: 'Use 6 to 72 characters.' };
    }
    if ((err as { code?: string } | null)?.code === 'PGRST202') {
      // Migration 012 applied but the Data API schema cache is stale (or 012 is missing).
      console.error('[slate] fill password RPC missing:', formatNeonError(err, 'PGRST202'));
      return { ok: false, message: 'Password lock isn’t available yet. Try again later.' };
    }
    console.error('[slate] fill password failed:', formatNeonError(err, 'unknown error'));
    return { ok: false, message: userNeonError(err, 'password') };
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
    const row = formRecordToRow(
      { ...form, slug },
      { publishedName: publishedNameColumn, closeColumns },
    );
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
      throw new SessionNotReadyError('Your sign-in expired. Sign out and back in, then try again.');
    }
    await write();
  }
  return slug;
}

async function upsertForm(form: FormRecord): Promise<void> {
  await ensureAuthForDataApi();

  const write = async () => {
    const neon = getNeon();
    const row = formRecordToRow(form, { publishedName: publishedNameColumn, closeColumns });
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
      throw new SessionNotReadyError('Your sign-in expired. Sign out and back in, then try again.');
    }
    await write();
  }
}

async function deleteFormRow(formId: string): Promise<void> {
  await ensureAuthForDataApi();
  const neon = getNeon();
  const { error } = await neon.from('forms').delete().eq('id', formId);
  if (error) throw error;
  // Its files: freed at once, deleted from storage now (ADR-067).
  afterPermanentDelete();
}

/** Coalesce rapid editor saves so older in-flight upserts can't overwrite newer ones. */
const queuedFormWrite = new Map<string, FormRecord>();
/**
 * What waits on a write: `onLanded` once it reaches the server, `onFail` if it
 * doesn't. A newer record that replaces a queued one carries the older one's
 * waiters too — it holds the older change — so a publish whose write merged into
 * an edit still hears how that write went (STU-5).
 */
type WriteWaiter = { onLanded?: () => void; onFail?: () => void; failTitle?: string };
const queuedWaiters = new Map<string, WriteWaiter[]>();
/**
 * Forms whose last write didn't reach the server, so the cache is ahead of it:
 * a refresh keeps the local record, and the editor sends it again (STU-8).
 */
const unsavedFormIds = new Set<string>();
const formWriteChain = new Map<string, Promise<void>>();
/** Form ids with a pending/completed permanent delete — block resurrecting upserts. */
const deletedFormIds = new Set<string>();
/**
 * When this browser last changed a form's cached record, or a write of it landed
 * (`Date.now()`). A fetch sent before that moment can answer with an older row;
 * the merge keeps the local record instead (audit B1).
 */
const localWriteAt = new Map<string, number>();

function touchLocal(formId: string): void {
  localWriteAt.set(formId, Date.now());
}

/** Any form has a write queued, on the wire, or not yet accepted by the server (audit B5). */
export function hasPendingFormWritesRemote(): boolean {
  return queuedFormWrite.size > 0 || formWriteChain.size > 0 || unsavedFormIds.size > 0;
}

/**
 * Server snapshot wins for settled rows; keep optimistic / in-flight locals
 * that have not appeared in the fetch yet (or are newer queued edits), and any
 * local record changed since the fetch went out (`fetchStartedAt`), because the
 * server's answer can predate that change (audit B1).
 */
function mergeHydratedForms(serverRows: FormRecord[], fetchStartedAt = Infinity): FormRecord[] {
  const byId = new Map(serverRows.map((f) => [f.id, f]));

  for (const [id, local] of queuedFormWrite) {
    if (deletedFormIds.has(id)) continue;
    byId.set(id, local);
  }

  // A write that failed left the cache ahead of the server: keep the owner's
  // edit until a write of it lands (STU-8). A form gone from the server was
  // deleted elsewhere, so its unsaved edit goes too rather than bring it back.
  for (const id of [...unsavedFormIds]) {
    if (queuedFormWrite.has(id)) continue;
    const local = cache.find((f) => f.id === id);
    if (local && byId.has(id) && !deletedFormIds.has(id)) byId.set(id, local);
    else unsavedFormIds.delete(id);
  }

  for (const local of cache) {
    if (deletedFormIds.has(local.id)) continue;
    if (queuedFormWrite.has(local.id)) continue;
    const touchedSinceFetch = (localWriteAt.get(local.id) ?? -Infinity) >= fetchStartedAt;
    if (formWriteChain.has(local.id) || touchedSinceFetch) {
      byId.set(local.id, local);
    }
  }

  return [...byId.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * `message` is owner copy; `title` replaces the toast's default heading; `formId`
 * says which form's write it was, when it was one form's.
 */
function emitPersistError(
  kind: 'form' | 'submission',
  message: string,
  title?: string,
  formId?: string,
): void {
  console.error(`[slate] ${kind} persist failed:`, message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('slate-persist-error', {
        detail: { kind, message, ...(title ? { title } : {}), ...(formId ? { formId } : {}) },
      }),
    );
  }
}

/** Log the raw error, tell the owner in plain words (QA COPY-01). */
function reportFormFailure(
  err: unknown,
  action: NeonAction,
  title?: string,
  formId?: string,
): void {
  console.error('[slate] form write failed:', formatNeonError(err, 'unknown error'));
  emitPersistError('form', userNeonError(err, action), title, formId);
}

function emitPersistOk(kind: 'form' | 'submission', formId?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('slate-persist-ok', { detail: { kind, ...(formId ? { formId } : {}) } }),
    );
  }
}

/**
 * `waiter.onFail` runs when the write carrying this change fails — this record's
 * own, or a newer one that replaced it in the queue — so an optimistic change
 * (trash, restore, publish) can be put back instead of looking done while the
 * server disagrees; `waiter.onLanded` runs when it lands.
 */
function enqueueFormUpsert(form: FormRecord, waiter?: WriteWaiter): void {
  if (deletedFormIds.has(form.id)) return;
  queuedFormWrite.set(form.id, form);
  touchLocal(form.id);
  if (waiter) queuedWaiters.set(form.id, [...(queuedWaiters.get(form.id) ?? []), waiter]);
  const prev = formWriteChain.get(form.id) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      /* keep chain alive */
    })
    .then(async () => {
      while (queuedFormWrite.has(form.id)) {
        if (deletedFormIds.has(form.id)) {
          queuedFormWrite.delete(form.id);
          queuedWaiters.delete(form.id);
          return;
        }
        const latest = queuedFormWrite.get(form.id)!;
        const waiters = queuedWaiters.get(form.id) ?? [];
        queuedFormWrite.delete(form.id);
        queuedWaiters.delete(form.id);
        try {
          await upsertForm(latest);
          touchLocal(form.id);
          unsavedFormIds.delete(form.id);
          emitPersistOk('form', form.id);
          for (const w of waiters) w.onLanded?.();
        } catch (err) {
          for (const w of waiters) w.onFail?.();
          // A trash or restore names itself; an edit says the change isn't saved.
          const own = waiters.find((w) => w.failTitle)?.failTitle;
          // An edit's change stays in the cache, ahead of the server, until a write of
          // this form lands (STU-8). A trash or restore put itself back just now.
          if (!own) {
            unsavedFormIds.add(form.id);
            resendWhenOnline();
          }
          reportFormFailure(err, own ? 'delete' : 'save', own, form.id);
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

/**
 * The form's last write didn't reach the server, so what this browser shows
 * isn't saved yet (STU-8). The editor sends it again when it opens.
 */
export function hasUnsavedFormEditRemote(formId: string): boolean {
  return unsavedFormIds.has(formId);
}

let resendHooked = false;

/** When the connection comes back, send each unsaved form again (STU-8). */
function resendWhenOnline(): void {
  if (resendHooked || typeof window === 'undefined') return;
  resendHooked = true;
  window.addEventListener('online', () => {
    for (const id of unsavedFormIds) {
      const local = read().find((f) => f.id === id);
      if (local && !queuedFormWrite.has(id)) enqueueFormUpsert(local);
    }
  });
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
  touchLocal(form.id);
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
        touchLocal(form.id);
        if (landedSlug !== latest.slug) {
          cache = read().map((f) => (f.id === form.id ? { ...f, slug: landedSlug } : f));
          notify();
        }
        // Named, so an open editor on another form never takes it as its own save (audit B9).
        emitPersistOk('form', form.id);
      } catch (err) {
        dropOptimisticForm(form.id);
        // A one-off to repeat, not an edit left unsaved: "Check your connection and try again." (R27)
        reportFormFailure(err, 'delete', 'Couldn’t create that form', form.id);
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
        // Its responses went with it on the server (001's cascade): forget them here
        // only now, so a delete that fails leaves them with the restored form (audit B10).
        dropFormSubmissionsLocal(formId);
        emitPersistOk('form', formId);
      } catch (err) {
        deletedFormIds.delete(formId);
        reportFormFailure(err, 'delete', 'Couldn’t delete that form', formId);
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
  // Already reported via slate-persist-error; the chain stays rejected for awaiters.
  next.catch(() => {});
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
    touchLocal(record.id);
    notify();
    return record;
  } catch (err) {
    if (isQuotaExceededError(err)) {
      throw new FormQuotaError(quotaFromUnknown(err) ?? getFormQuotaRemote());
    }
    // Logged and said, never swallowed (audit B13): the caller only learns "null".
    reportFormFailure(err, 'delete', 'Couldn’t create that form', record.id);
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
    touchLocal(formId);
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
    touchLocal(formId);
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
    touchLocal(formId);
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
    dropFormSubmissionsLocal(formId);
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
      dropFormSubmissionsLocal(f.id);
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
    // The trigger honours this only because it equals `name`: Republish of a rename (017).
    publishedName: form.name,
    status: 'published',
  });
  return updated;
}

export async function unpublishFormRemote(formId: string): Promise<FormRecord | null> {
  const [updated] = await updateFormRemote(formId, { status: 'draft' });
  return updated;
}

/**
 * Restore re-creates rows, so the cache mirrors what the database keeps: no password
 * survives it, and a published row's title is its own name (017's insert trigger).
 */
function asRestored(forms: FormRecord[]): FormRecord[] {
  return forms.map(({ fillLocked: _drop, publishedName: _title, ...rest }) =>
    rest.publishedSchema ? { ...rest, publishedName: rest.name } : rest,
  );
}

export async function replaceAllFormsRemote(input: FormRecord[]): Promise<boolean> {
  const forms = asRestored(input);
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
    emitPersistError(
      'form',
      formQuotaUserMessage(getFormQuotaRemote()),
      'Couldn’t create that form',
    );
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

export type FormWriteOptions = {
  /** Runs if the write carrying this patch fails, with the record before and after it. */
  onFail?: (before: FormRecord, after: FormRecord) => void;
  /** Runs once the write carrying this patch has landed. */
  onLanded?: () => void;
  /**
   * A one-off setting (unpublish, closing, a tracked link), not an edit: when its
   * write fails, put the fields the patch set back the way they were — before
   * `onFail` — instead of leaving the panel saying something the server never
   * took (audit B4). `failTitle` heads the shell's toast.
   */
  rollback?: boolean;
  failTitle?: string;
};

export function updateFormRemoteSync(
  formId: string,
  patch: Partial<Omit<FormRecord, 'id' | 'createdAt'>>,
  opts: FormWriteOptions = {},
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
  const { onFail, onLanded, rollback, failTitle } = opts;
  const keys = Object.keys(patch) as Array<keyof FormRecord>;
  enqueueFormUpsert(next, {
    onFail:
      onFail || rollback
        ? () => {
            if (rollback) rollbackForm(prev, next, keys);
            onFail?.(prev, next);
          }
        : undefined,
    onLanded,
    ...(failTitle ? { failTitle } : {}),
  });
  return [next, true];
}

/**
 * Put `before` back. When something newer has replaced `after` since (an edit
 * merged into the same write), put back only `keys` — the fields this change set —
 * and only while the newer record still has them as `after` set them.
 */
function rollbackForm(
  before: FormRecord,
  after: FormRecord,
  keys: ReadonlyArray<keyof FormRecord> = [],
): void {
  const idx = read().findIndex((f) => f.id === before.id);
  if (idx === -1) return;
  const now = read()[idx]!;
  let back: FormRecord;
  if (now === after) back = before;
  else if (keys.length && keys.every((k) => now[k] === after[k])) {
    back = { ...now };
    const record = back as Record<string, unknown>;
    for (const k of keys) {
      if (before[k] === undefined) delete record[k];
      else record[k] = before[k];
    }
  } else return;
  const copy = [...read()];
  copy[idx] = back;
  cache = copy;
  touchLocal(before.id);
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
  enqueueFormUpsert(next, {
    onFail: () => rollbackForm(before, next, ['deletedAt']),
    failTitle: 'Couldn’t move that form to Trash',
  });
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
  enqueueFormUpsert(next, {
    onFail: () => rollbackForm(before, next, ['deletedAt']),
    failTitle: 'Couldn’t restore that form',
  });
  return true;
}

export function restoreAllFormsRemoteSync(): boolean {
  const toRestore: Array<{ before: FormRecord; next: FormRecord }> = [];
  const updated = read().map((f) => {
    if (!isTrashed(f)) return f;
    const { deletedAt: _r, ...rest } = f;
    const next = { ...rest, updatedAt: new Date().toISOString() };
    toRestore.push({ before: f, next });
    return next;
  });
  cache = updated;
  notify();
  // Each one that doesn't reach the server goes back to the trash, and the toast
  // says what failed (R27): Trash never looks empty while the server disagrees.
  for (const { before, next } of toRestore) {
    enqueueFormUpsert(next, {
      onFail: () => rollbackForm(before, next, ['deletedAt']),
      failTitle: 'Couldn’t restore those forms',
    });
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

/**
 * Publish the draft. The write lands in the background: `onLanded` runs once
 * the write carrying it reached the server (its own, or an edit's it merged
 * into), `onFail` once it didn't — after the form is put back and the shell told.
 */
export function publishFormRemoteSync(
  formId: string,
  onFail?: () => void,
  onLanded?: () => void,
): FormRecord | null {
  const form = getFormRemote(formId);
  if (!form) return null;
  const [updated] = updateFormRemoteSync(
    formId,
    {
      publishedSchema: form.schema,
      // The trigger honours this only because it equals `name`: Republish of a rename (017).
      publishedName: form.name,
      status: 'published',
    },
    {
      onFail: (before, after) => {
        // The publish never reached the server, so it isn't live: put the draft
        // state back and say so (the shell's toast), instead of a "Live" that
        // isn't (COPY-10). Runs before the save error, which the toast folds in.
        rollbackForm(before, after, ['status', 'publishedSchema', 'publishedName']);
        if (typeof window !== 'undefined') {
          // A republish that fails leaves the earlier version live (STU-6, COPY-R1).
          const wasLive = before.status === 'published' && Boolean(before.publishedSchema);
          window.dispatchEvent(
            new CustomEvent('slate-publish-error', { detail: { formId, wasLive } }),
          );
        }
        onFail?.();
      },
      onLanded,
    },
  );
  return updated;
}

/**
 * Take the public link down. Like publish, the write lands in the background:
 * a failure puts "published" back and the shell says so, `onLanded` runs once
 * the server has it (audit B4).
 */
export function unpublishFormRemoteSync(
  formId: string,
  opts: { onFail?: () => void; onLanded?: () => void } = {},
): FormRecord | null {
  const [updated] = updateFormRemoteSync(
    formId,
    { status: 'draft' },
    {
      rollback: true,
      failTitle: 'Couldn’t unpublish that form',
      onFail: () => opts.onFail?.(),
      onLanded: opts.onLanded,
    },
  );
  return updated;
}

export function replaceAllFormsRemoteSync(input: FormRecord[]): boolean {
  const forms = asRestored(input);
  const prev = read();
  // Never fire-and-forget a wipe — restore/backup must finish or roll back.
  cache = [...forms];
  notify();
  void (async () => {
    try {
      for (const f of prev) await deleteFormRow(f.id);
      for (const f of forms) await upsertForm(f);
    } catch (err) {
      reportFormFailure(err, 'restore-backup', 'Couldn’t restore your backup');
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
