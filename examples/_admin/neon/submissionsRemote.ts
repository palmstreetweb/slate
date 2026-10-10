/**
 * Neon-backed submissions cache + persistence (ADR-029, ADR-049).
 *
 * Two layers so the studio never downloads every answer ever received:
 *  - `index`: every response the owner has, slim (id, form, time, trashed).
 *    Loaded once per session; drives counts, "last response", trash counts,
 *    and new-response detection.
 *  - `full`: responses with answers. The most recent ones on boot, anything
 *    new since, and all of a form's responses once its Responses page opens.
 *
 * Polling only asks for rows newer than the newest one seen. Trash / restore /
 * empty-trash are single column updates or deletes, never whole-row rewrites.
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import type { DbSubmissionRow } from './database.types.js';
import { getNeon } from './client.js';
import { afterPermanentDelete } from './storageQuotaRemote.js';
import { ensureAuthForDataApi, waitForAuthReady } from './ensureAuth.js';
import {
  SessionNotReadyError,
  formatNeonError,
  isRlsOrAuthError,
  userNeonError,
} from './neonError.js';
import { rowToSubmission, submissionToRow } from './mappers.js';

type Listener = (subs: StoredSubmission[]) => void;

export type SubmissionIndexEntry = {
  id: string;
  formId: string;
  receivedAt: string;
  deletedAt?: string;
};

type FormStats = { active: number; trashed: number; lastAt: string | null };

/** Rows per Data API page. PostgREST may cap responses; page until short. */
const PAGE = 1000;
/** Full rows fetched on boot so the inbox has answers to preview. */
const RECENT_FULL = 50;
/** More new rows than this in one poll → reload the index instead. */
const POLL_LIMIT = 200;
/** Chunk size for batch writes (URL length for `in (...)`, body size for inserts). */
const BATCH = 200;
const SLIM_COLUMNS = 'id,form_id,received_at,deleted_at';

let index = new Map<string, SubmissionIndexEntry>();
let full = new Map<string, StoredSubmission>();
const loadedForms = new Set<string>();
const formLoads = new Map<string, Promise<void>>();
let hydrated = false;
let writeGeneration = 0;
const listeners = new Set<Listener>();

// Derived views, rebuilt lazily after any change.
let sortedFullCache: StoredSubmission[] | null = null;
let sortedIndexCache: SubmissionIndexEntry[] | null = null;
let statsCache: Map<string, FormStats> | null = null;

function invalidate(): void {
  sortedFullCache = null;
  sortedIndexCache = null;
  statsCache = null;
}

function byNewest<T extends { receivedAt: string; id: string }>(a: T, b: T): number {
  if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

function sortedFull(): StoredSubmission[] {
  if (!sortedFullCache) sortedFullCache = [...full.values()].sort(byNewest);
  return sortedFullCache;
}

function sortedIndex(): SubmissionIndexEntry[] {
  if (!sortedIndexCache) sortedIndexCache = [...index.values()].sort(byNewest);
  return sortedIndexCache;
}

function stats(): Map<string, FormStats> {
  if (statsCache) return statsCache;
  const m = new Map<string, FormStats>();
  for (const e of index.values()) {
    let s = m.get(e.formId);
    if (!s) {
      s = { active: 0, trashed: 0, lastAt: null };
      m.set(e.formId, s);
    }
    if (e.deletedAt) {
      s.trashed += 1;
    } else {
      s.active += 1;
      if (!s.lastAt || e.receivedAt > s.lastAt) s.lastAt = e.receivedAt;
    }
  }
  statsCache = m;
  return m;
}

function notify(): void {
  invalidate();
  const active = sortedFull().filter((s) => !s.deletedAt);
  listeners.forEach((l) => l(active));
}

function toIndex(
  sub: Pick<StoredSubmission, 'id' | 'formId' | 'receivedAt' | 'deletedAt'>,
): SubmissionIndexEntry {
  return {
    id: sub.id,
    formId: sub.formId,
    receivedAt: sub.receivedAt,
    ...(sub.deletedAt ? { deletedAt: sub.deletedAt } : {}),
  };
}

function putFull(sub: StoredSubmission): void {
  full.set(sub.id, sub);
  index.set(sub.id, toIndex(sub));
}

function removeLocal(id: string): void {
  full.delete(id);
  index.delete(id);
}

/** Apply a trashed/restored stamp to both layers. `undefined` = restore. */
function stampDeleted(id: string, at: string | undefined): void {
  const e = index.get(id);
  if (e) {
    const { deletedAt: _d, ...rest } = e;
    index.set(id, at ? { ...rest, deletedAt: at } : rest);
  }
  const f = full.get(id);
  if (f) {
    const { deletedAt: _d, ...rest } = f;
    full.set(id, at ? { ...rest, deletedAt: at } : rest);
  }
}

/**
 * Rows with a write on the wire, and how many. A poll, a reload or a form load
 * that answers meanwhile reads the row as it was before the write, so the
 * server's copy of these rows is left alone until the write settles (audit B8).
 */
const pendingWrites = new Map<string, number>();

function hasPendingWrite(id: string): boolean {
  return pendingWrites.has(id);
}

function holdPending(ids: ReadonlyArray<string>): void {
  for (const id of ids) pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
}

function releasePending(ids: ReadonlyArray<string>): void {
  for (const id of ids) {
    const n = (pendingWrites.get(id) ?? 1) - 1;
    if (n <= 0) pendingWrites.delete(id);
    else pendingWrites.set(id, n);
  }
}

/** One row's state in both layers, for a rollback (audit B3). */
type RowState = { index: SubmissionIndexEntry | undefined; full: StoredSubmission | undefined };

function rowState(id: string): RowState {
  return { index: index.get(id), full: full.get(id) };
}

function setRowState(id: string, s: RowState): void {
  if (s.index) index.set(id, s.index);
  else index.delete(id);
  if (s.full) full.set(id, s.full);
  else full.delete(id);
}

function newestSeen(): string | null {
  return sortedIndex()[0]?.receivedAt ?? null;
}

export function isSubmissionsHydrated(): boolean {
  return hydrated;
}

/** Drop cached rows (e.g. on sign-out). Next hydrate refetches from Postgres. */
export function clearSubmissionsRemoteCache(): void {
  writeGeneration += 1;
  index = new Map();
  full = new Map();
  loadedForms.clear();
  formLoads.clear();
  pendingWrites.clear();
  hydrated = false;
  notify();
}

export function bumpSubmissionsRemoteGeneration(): void {
  writeGeneration += 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

type PageResult<T> = { data: T[] | null; error: unknown };

/** Fetch every page of a query ordered newest first. */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function slimQuery() {
  return getNeon()
    .from('submissions')
    .select(SLIM_COLUMNS)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false });
}

async function fetchIndex(): Promise<SubmissionIndexEntry[]> {
  const rows = await fetchAllPages<
    Pick<DbSubmissionRow, 'id' | 'form_id' | 'received_at' | 'deleted_at'>
  >((from, to) => slimQuery().range(from, to));
  return rows.map((r) => ({
    id: r.id,
    formId: r.form_id,
    receivedAt: r.received_at,
    ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
  }));
}

async function fetchRecentFull(): Promise<StoredSubmission[]> {
  const { data, error } = await getNeon()
    .from('submissions')
    .select('*')
    .is('deleted_at', null)
    .order('received_at', { ascending: false })
    .limit(RECENT_FULL);
  if (error) throw error;
  return ((data ?? []) as DbSubmissionRow[]).map(rowToSubmission);
}

/**
 * Boot: the slim index of everything plus the most recent full rows.
 * `soft` skips the empty-result auth-settle retry (the caller already settled auth).
 */
export async function hydrateSubmissionsRemote(opts?: { soft?: boolean }): Promise<void> {
  const gen = writeGeneration;
  await ensureAuthForDataApi();

  let [idx, recent] = await Promise.all([fetchIndex(), fetchRecentFull()]);

  if (idx.length === 0 && !opts?.soft) {
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new SessionNotReadyError('Slate couldn’t confirm it’s you yet.');
    }
    await sleep(150);
    await ensureAuthForDataApi();
    [idx, recent] = await Promise.all([fetchIndex(), fetchRecentFull()]);
  }

  if (gen !== writeGeneration) return;

  if (idx.length === 0 && index.size > 0) {
    console.warn(
      '[slate] Empty submissions index after retries — keeping cached rows (%d).',
      index.size,
    );
    hydrated = true;
    return;
  }

  const prevIndex = index;
  const prevFull = full;
  index = new Map(idx.map((e) => [e.id, e]));
  // Keep full rows we already hold for loaded forms; drop ones that vanished.
  const nextFull = new Map<string, StoredSubmission>();
  for (const [id, sub] of full) {
    const e = index.get(id);
    if (e) nextFull.set(id, e.deletedAt ? { ...sub, deletedAt: e.deletedAt } : withoutDeleted(sub));
  }
  for (const sub of recent) nextFull.set(sub.id, sub);
  full = nextFull;
  // A row with a write on the wire stays as this browser has it (audit B8).
  for (const id of pendingWrites.keys()) {
    setRowState(id, { index: prevIndex.get(id), full: prevFull.get(id) });
  }
  // A loaded form must hold every one of its rows. If the index shows rows we
  // don't have answers for (sent from another device meanwhile), refetch it.
  for (const formId of [...loadedForms]) {
    for (const e of index.values()) {
      if (e.formId === formId && !full.has(e.id)) {
        loadedForms.delete(formId);
        break;
      }
    }
  }
  hydrated = true;
  notify();
}

function withoutDeleted(sub: StoredSubmission): StoredSubmission {
  const { deletedAt: _d, ...rest } = sub;
  return rest;
}

/**
 * Poll: ask only for rows at or after the newest one we have.
 * `full: true` (manual Refresh) also reloads the index, which picks up trash /
 * delete changes made on another device.
 */
export async function refreshSubmissionsRemote(opts?: { full?: boolean }): Promise<void> {
  if (!hydrated || opts?.full) {
    await hydrateSubmissionsRemote({ soft: true });
    return;
  }
  const gen = writeGeneration;
  await ensureAuthForDataApi();
  const since = newestSeen();
  let query = getNeon()
    .from('submissions')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(POLL_LIMIT);
  if (since) query = query.gte('received_at', since);
  const { data, error } = await query;
  if (error) throw error;
  if (gen !== writeGeneration) return;
  const rows = ((data ?? []) as DbSubmissionRow[]).map(rowToSubmission);
  if (rows.length >= POLL_LIMIT) {
    // A burst bigger than one page — the index may now have gaps. Reload it.
    await hydrateSubmissionsRemote({ soft: true });
    return;
  }
  let changed = false;
  for (const sub of rows) {
    // Its write is still out; the server answered with the row before it (audit B8).
    if (hasPendingWrite(sub.id)) continue;
    if (!full.has(sub.id)) changed = true;
    putFull(sub);
  }
  if (changed) notify();
}

/** All of one form's responses (active + trash), with answers. Memoized per form. */
export function loadFormSubmissionsRemote(
  formId: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (!opts?.force && loadedForms.has(formId)) return Promise.resolve();
  const inflight = formLoads.get(formId);
  if (inflight && !opts?.force) return inflight;
  const gen = writeGeneration;
  const p = (async () => {
    await ensureAuthForDataApi();
    const rows = await fetchAllPages<DbSubmissionRow>((from, to) =>
      getNeon()
        .from('submissions')
        .select('*')
        .eq('form_id', formId)
        .order('received_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    );
    if (gen !== writeGeneration) return;
    const seen = new Set<string>();
    for (const row of rows) {
      const sub = rowToSubmission(row);
      seen.add(sub.id);
      if (hasPendingWrite(sub.id)) continue;
      putFull(sub);
    }
    // Rows of this form that no longer exist server-side.
    for (const e of [...index.values()]) {
      if (e.formId === formId && !seen.has(e.id) && !hasPendingWrite(e.id)) removeLocal(e.id);
    }
    loadedForms.add(formId);
    notify();
  })().finally(() => {
    if (formLoads.get(formId) === p) formLoads.delete(formId);
  });
  formLoads.set(formId, p);
  return p;
}

export function isFormSubmissionsLoadedRemote(formId: string): boolean {
  return loadedForms.has(formId);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The raw error goes to the console; the owner reads one plain sentence (QA COPY-01). */
function emitPersistError(err: unknown, title: string): void {
  console.error('[slate] submission persist failed:', formatNeonError(err, 'unknown error'));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('slate-persist-error', {
        detail: { kind: 'submission', title, message: userNeonError(err, 'response') },
      }),
    );
  }
}

/** Run a write with one auth-settle retry, like the rest of the Neon layer. */
async function withAuthRetry(write: () => PromiseLike<{ error: unknown }>): Promise<void> {
  await ensureAuthForDataApi();
  const once = async () => {
    const { error } = await write();
    if (error) throw error;
  };
  try {
    await once();
  } catch (err) {
    if (!isRlsOrAuthError(err)) throw err;
    const auth = await waitForAuthReady(3);
    if (!auth.ok) throw err;
    await once();
  }
}

/**
 * Optimistic local change to the rows `ids`, then the server write; on failure
 * put back only those rows, and only the ones nothing else has changed since
 * (a later write that landed, a poll) — never every newer local change (audit
 * B3). `failTitle` heads the toast ("Couldn’t empty Trash"). Resolves true once
 * the write landed, false once it was rolled back (and said).
 */
function optimistic(
  ids: ReadonlyArray<string>,
  apply: () => void,
  write: () => Promise<void>,
  failTitle: string,
): Promise<boolean> {
  const touched = [...new Set(ids)];
  const before = new Map(touched.map((id) => [id, rowState(id)]));
  apply();
  const after = new Map(touched.map((id) => [id, rowState(id)]));
  notify();
  holdPending(touched);
  return write()
    .then(
      () => true,
      (err: unknown) => {
        emitPersistError(err, failTitle);
        for (const id of touched) {
          const now = rowState(id);
          const was = after.get(id)!;
          if (now.index !== was.index || now.full !== was.full) continue;
          setRowState(id, before.get(id)!);
        }
        notify();
        return false;
      },
    )
    .finally(() => releasePending(touched));
}

function chunks<T>(list: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function makeSubmission(formId: string, answers: Answers, meta: SubmitMeta): StoredSubmission {
  return {
    id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    formId,
    receivedAt: new Date().toISOString(),
    answers,
    meta: {
      startedAt: meta.startedAt.toISOString(),
      completedAt: meta.completedAt.toISOString(),
      durationMs: meta.durationMs,
      questionsVisited: meta.questionsVisited,
      hiddenFields: meta.hiddenFields,
      score: meta.score,
      ...(meta.estimate ? { estimate: meta.estimate } : {}),
    },
  };
}

/** Studio preview submit — the public path goes through the submit Function. */
export function addSubmissionRemoteSync(
  formId: string,
  answers: Answers,
  meta: SubmitMeta,
): StoredSubmission {
  const sub = makeSubmission(formId, answers, meta);
  optimistic(
    [sub.id],
    () => putFull(sub),
    () => withAuthRetry(() => getNeon().from('submissions').insert(submissionToRow(sub))),
    'Couldn’t save that test response',
  );
  return sub;
}

export function trashSubmissionsRemoteSync(formId?: string): void {
  const now = new Date().toISOString();
  const ids = [...index.values()]
    .filter((e) => !e.deletedAt && (!formId || e.formId === formId))
    .map((e) => e.id);
  optimistic(
    ids,
    () => {
      for (const id of ids) stampDeleted(id, now);
    },
    () =>
      withAuthRetry(() => {
        let q = getNeon().from('submissions').update({ deleted_at: now }).is('deleted_at', null);
        if (formId) q = q.eq('form_id', formId);
        return q;
      }),
    'Couldn’t move those responses to Trash',
  );
}

export function trashSubmissionRemoteSync(submissionId: string): void {
  const now = new Date().toISOString();
  optimistic(
    [submissionId],
    () => stampDeleted(submissionId, now),
    () =>
      withAuthRetry(() =>
        getNeon().from('submissions').update({ deleted_at: now }).eq('id', submissionId),
      ),
    'Couldn’t move that response to Trash',
  );
}

export function restoreSubmissionRemoteSync(submissionId: string): void {
  optimistic(
    [submissionId],
    () => stampDeleted(submissionId, undefined),
    () =>
      withAuthRetry(() =>
        getNeon().from('submissions').update({ deleted_at: null }).eq('id', submissionId),
      ),
    'Couldn’t restore that response',
  );
}

/** Restore all of a form's trash; resolves true once the server has it (QA leftover). */
export function restoreSubmissionsRemoteSync(formId: string): Promise<boolean> {
  const ids = [...index.values()]
    .filter((e) => e.deletedAt && e.formId === formId)
    .map((e) => e.id);
  return optimistic(
    ids,
    () => {
      for (const id of ids) stampDeleted(id, undefined);
    },
    () =>
      withAuthRetry(() =>
        getNeon()
          .from('submissions')
          .update({ deleted_at: null })
          .eq('form_id', formId)
          .not('deleted_at', 'is', null),
      ),
    'Couldn’t restore those responses',
  );
}

export function permanentlyDeleteSubmissionRemoteSync(submissionId: string): void {
  optimistic(
    [submissionId],
    () => removeLocal(submissionId),
    () =>
      withAuthRetry(() => getNeon().from('submissions').delete().eq('id', submissionId)).then(
        afterPermanentDelete,
      ),
    'Couldn’t delete that response',
  );
}

export function emptyTrashRemoteSync(formId?: string): void {
  const ids = [...index.values()]
    .filter((e) => e.deletedAt && (!formId || e.formId === formId))
    .map((e) => e.id);
  optimistic(
    ids,
    () => {
      for (const id of ids) removeLocal(id);
    },
    () =>
      withAuthRetry(() => {
        let q = getNeon().from('submissions').delete().not('deleted_at', 'is', null);
        if (formId) q = q.eq('form_id', formId);
        return q;
      }).then(afterPermanentDelete),
    'Couldn’t empty Trash',
  );
}

export function purgeSubmissionsRemoteSync(formId: string): void {
  const ids = [...index.values()].filter((e) => e.formId === formId).map((e) => e.id);
  optimistic(
    ids,
    () => {
      for (const id of ids) removeLocal(id);
      loadedForms.delete(formId);
    },
    () =>
      withAuthRetry(() => getNeon().from('submissions').delete().eq('form_id', formId)).then(
        afterPermanentDelete,
      ),
    'Couldn’t delete those responses',
  );
}

/**
 * Put one answer into the cached row after the database changed it (the
 * roster's move, ADR-066 — signupMove.ts makes the write through its RPC).
 */
export function patchAnswerRemote(submissionId: string, questionId: string, value: unknown): void {
  const sub = full.get(submissionId);
  if (!sub) return;
  putFull({
    ...sub,
    answers: { ...sub.answers, [questionId]: value } as StoredSubmission['answers'],
  });
  notify();
}

/** Backup restore (offline-first feature; kept correct for cloud). */
export function replaceAllSubmissionsRemoteSync(subs: StoredSubmission[]): void {
  const existing = [...index.keys()];
  optimistic(
    [...existing, ...subs.map((s) => s.id)],
    () => {
      index = new Map();
      full = new Map();
      for (const s of subs) putFull(s);
    },
    async () => {
      for (const ids of chunks(existing)) {
        await withAuthRetry(() => getNeon().from('submissions').delete().in('id', ids));
      }
      for (const batch of chunks(subs)) {
        await withAuthRetry(() => getNeon().from('submissions').insert(batch.map(submissionToRow)));
      }
    },
    'Couldn’t restore the responses from your backup',
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function subscribeSubmissionsRemote(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Active responses with answers (a form's are complete once it's loaded). */
export function listSubmissionsRemote(formId?: string): StoredSubmission[] {
  const all = sortedFull().filter((s) => !s.deletedAt);
  return formId ? all.filter((s) => s.formId === formId) : all;
}

export function listAllSubmissionsRemote(): StoredSubmission[] {
  return sortedFull();
}

export function listTrashedSubmissionsRemote(formId?: string): StoredSubmission[] {
  const trashed = sortedFull().filter((s) => Boolean(s.deletedAt));
  return formId ? trashed.filter((s) => s.formId === formId) : trashed;
}

/** Every active response, slim, newest first — complete even before a form loads. */
export function listSubmissionIndexRemote(): SubmissionIndexEntry[] {
  return sortedIndex().filter((e) => !e.deletedAt);
}

export function getSubmissionRemote(id: string): StoredSubmission | undefined {
  return full.get(id);
}

export function countSubmissionsRemote(formId?: string): number {
  if (formId) return stats().get(formId)?.active ?? 0;
  let n = 0;
  for (const s of stats().values()) n += s.active;
  return n;
}

export function countTrashedSubmissionsRemote(formId?: string): number {
  if (formId) return stats().get(formId)?.trashed ?? 0;
  let n = 0;
  for (const s of stats().values()) n += s.trashed;
  return n;
}

export function lastSubmissionAtRemote(formId?: string): string | null {
  if (formId) return stats().get(formId)?.lastAt ?? null;
  return listSubmissionIndexRemote()[0]?.receivedAt ?? null;
}

export function probeSubmissionsRemote(): 'ok' | 'corrupt' {
  return 'ok';
}
