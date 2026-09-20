/**
 * Neon-backed submissions cache + persistence (ADR-029).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { getNeon } from './client.js';
import { ensureAuthForDataApi, waitForAuthReady } from './ensureAuth.js';
import { formatNeonError, isRlsOrAuthError } from './neonError.js';
import { rowToSubmission, submissionToRow } from './mappers.js';

type Listener = (subs: StoredSubmission[]) => void;

let cache: StoredSubmission[] = [];
let hydrated = false;
let writeGeneration = 0;
/** Block upserts after permanent delete so trash upserts can't resurrect rows. */
const deletedSubmissionIds = new Set<string>();
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l([...cache]));
}

export function isSubmissionsHydrated(): boolean {
  return hydrated;
}

/** Drop cached rows (e.g. on sign-out). Next hydrate refetches from Postgres. */
export function clearSubmissionsRemoteCache(): void {
  writeGeneration += 1;
  deletedSubmissionIds.clear();
  cache = [];
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

export async function hydrateSubmissionsRemote(opts?: { soft?: boolean }): Promise<void> {
  const gen = writeGeneration;
  await ensureAuthForDataApi();

  const neon = getNeon();

  const fetchSubs = async () => {
    const { data, error } = await neon
      .from('submissions')
      .select('*')
      .order('received_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  };

  let rows = await fetchSubs();

  if (rows.length === 0 && !opts?.soft) {
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new Error(
        'Signed in, but the database could not resolve your user id from the session. Sign out and back in, then try again.',
      );
    }
    await sleep(150);
    await ensureAuthForDataApi();
    rows = await fetchSubs();
  }

  if (gen !== writeGeneration) return;

  const next = rows.map(rowToSubmission);

  if (next.length === 0 && cache.length > 0) {
    console.warn(
      '[slate] Empty submissions fetch after retries — keeping cached rows (%d).',
      cache.length,
    );
    hydrated = true;
    return;
  }

  cache = next;
  hydrated = true;
  notify();
}

/** Re-fetch submissions without touching forms (Responses page / tab focus). */
export async function refreshSubmissionsRemote(): Promise<void> {
  await hydrateSubmissionsRemote({ soft: true });
}

function read(): StoredSubmission[] {
  return cache;
}

function isActive(s: StoredSubmission): boolean {
  return !s.deletedAt;
}

function isTrashed(s: StoredSubmission): boolean {
  return Boolean(s.deletedAt);
}

async function upsertSubmission(sub: StoredSubmission): Promise<void> {
  if (deletedSubmissionIds.has(sub.id)) return;
  await ensureAuthForDataApi();
  const write = async () => {
    if (deletedSubmissionIds.has(sub.id)) return;
    const neon = getNeon();
    const row = submissionToRow(sub);
    const { error } = await neon.from('submissions').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  };
  try {
    await write();
  } catch (err) {
    if (!isRlsOrAuthError(err)) throw err;
    const auth = await waitForAuthReady(3);
    if (!auth.ok) {
      throw new Error(
        formatNeonError(err, 'Could not save submission — sign out and back in, then try again.'),
      );
    }
    await write();
  }
}

async function deleteSubmissionRow(id: string): Promise<void> {
  await ensureAuthForDataApi();
  const neon = getNeon();
  const { error } = await neon.from('submissions').delete().eq('id', id);
  if (error) throw error;
}

export function addSubmissionRemoteSync(
  formId: string,
  answers: Answers,
  meta: SubmitMeta,
): StoredSubmission {
  const sub: StoredSubmission = {
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
    },
  };
  cache = [sub, ...read()];
  notify();
  void upsertSubmission(sub).catch((err) => {
    console.error('[slate] Failed to persist submission — rolling back cache', err);
    cache = read().filter((s) => s.id !== sub.id);
    notify();
  });
  return sub;
}

function emitPersistError(message: string): void {
  console.error('[slate] submission persist failed:', message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('slate-persist-error', { detail: { kind: 'submission', message } }),
    );
  }
}

export function trashSubmissionsRemoteSync(formId?: string): void {
  const now = new Date().toISOString();
  const prev = read();
  cache = prev.map((s) =>
    isActive(s) && (!formId || s.formId === formId) ? { ...s, deletedAt: now } : s,
  );
  notify();
  for (const s of read().filter((x) => isTrashed(x) && x.deletedAt === now)) {
    void upsertSubmission(s).catch((err) => {
      emitPersistError(formatNeonError(err, 'Could not trash response'));
      cache = prev;
      notify();
    });
  }
}

export function trashSubmissionRemoteSync(submissionId: string): void {
  const now = new Date().toISOString();
  const prev = read();
  cache = prev.map((s) =>
    s.id === submissionId && isActive(s) ? { ...s, deletedAt: now } : s,
  );
  notify();
  const sub = read().find((s) => s.id === submissionId);
  if (sub) {
    void upsertSubmission(sub).catch((err) => {
      emitPersistError(formatNeonError(err, 'Could not trash response'));
      cache = prev;
      notify();
    });
  }
}

export function restoreSubmissionRemoteSync(submissionId: string): void {
  const prev = read();
  cache = prev.map((s) => {
    if (s.id !== submissionId) return s;
    const { deletedAt: _r, ...rest } = s;
    return rest;
  });
  notify();
  const sub = read().find((s) => s.id === submissionId);
  if (sub) {
    void upsertSubmission(sub).catch((err) => {
      emitPersistError(formatNeonError(err, 'Could not restore response'));
      cache = prev;
      notify();
    });
  }
}

export function restoreSubmissionsRemoteSync(formId: string): void {
  const prev = read();
  cache = prev.map((s) => {
    if (s.formId !== formId || !isTrashed(s)) return s;
    const { deletedAt: _r, ...rest } = s;
    return rest;
  });
  notify();
  for (const s of read().filter((x) => x.formId === formId && isActive(x))) {
    void upsertSubmission(s).catch((err) => {
      emitPersistError(formatNeonError(err, 'Could not restore responses'));
      cache = prev;
      notify();
    });
  }
}

export function permanentlyDeleteSubmissionRemoteSync(submissionId: string): void {
  const prev = read().find((s) => s.id === submissionId);
  cache = read().filter((s) => s.id !== submissionId);
  notify();
  deletedSubmissionIds.add(submissionId);
  void deleteSubmissionRow(submissionId).catch((err) => {
    deletedSubmissionIds.delete(submissionId);
    emitPersistError(formatNeonError(err, 'Could not delete response'));
    if (prev) {
      cache = [prev, ...read().filter((s) => s.id !== prev.id)];
      notify();
    }
  });
}

export function emptyTrashRemoteSync(formId?: string): void {
  const toDelete = read().filter((s) => isTrashed(s) && (!formId || s.formId === formId));
  const prev = read();
  for (const s of toDelete) deletedSubmissionIds.add(s.id);
  cache = read().filter((s) => !isTrashed(s) || (formId && s.formId !== formId));
  notify();
  void (async () => {
    try {
      for (const s of toDelete) await deleteSubmissionRow(s.id);
    } catch (err) {
      for (const s of toDelete) deletedSubmissionIds.delete(s.id);
      emitPersistError(formatNeonError(err, 'Could not empty trash'));
      cache = prev;
      notify();
    }
  })();
}

export function purgeSubmissionsRemoteSync(formId: string): void {
  const toDelete = read().filter((s) => s.formId === formId);
  const prev = read();
  for (const s of toDelete) deletedSubmissionIds.add(s.id);
  cache = read().filter((s) => s.formId !== formId);
  notify();
  void (async () => {
    try {
      for (const s of toDelete) await deleteSubmissionRow(s.id);
    } catch (err) {
      for (const s of toDelete) deletedSubmissionIds.delete(s.id);
      emitPersistError(formatNeonError(err, 'Could not purge responses'));
      cache = prev;
      notify();
    }
  })();
}

export function replaceAllSubmissionsRemoteSync(subs: StoredSubmission[]): void {
  const prev = read();
  cache = [...subs];
  notify();
  void (async () => {
    try {
      for (const s of prev) await deleteSubmissionRow(s.id);
      for (const s of subs) await upsertSubmission(s);
    } catch (err) {
      emitPersistError(formatNeonError(err, 'Could not restore submissions backup'));
      try {
        await hydrateSubmissionsRemote({ soft: true });
      } catch {
        cache = prev;
        notify();
      }
    }
  })();
}

export function subscribeSubmissionsRemote(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listSubmissionsRemote(formId?: string): StoredSubmission[] {
  const all = read().filter(isActive);
  return formId ? all.filter((s) => s.formId === formId) : all;
}

export function listAllSubmissionsRemote(): StoredSubmission[] {
  return read();
}

export function listTrashedSubmissionsRemote(formId?: string): StoredSubmission[] {
  const trashed = read().filter(isTrashed);
  return formId ? trashed.filter((s) => s.formId === formId) : trashed;
}

export function countSubmissionsRemote(formId?: string): number {
  return listSubmissionsRemote(formId).length;
}

export function lastSubmissionAtRemote(formId?: string): string | null {
  const subs = listSubmissionsRemote(formId);
  return subs.length > 0 ? subs[0]!.receivedAt : null;
}

export async function trashSubmissionsRemote(formId?: string): Promise<void> {
  const now = new Date().toISOString();
  const targets = read().filter((s) => isActive(s) && (!formId || s.formId === formId));
  for (const s of targets) {
    await upsertSubmission({ ...s, deletedAt: now });
  }
  cache = read().map((s) =>
    isActive(s) && (!formId || s.formId === formId) ? { ...s, deletedAt: now } : s,
  );
  notify();
}

export async function trashSubmissionRemote(submissionId: string): Promise<void> {
  const now = new Date().toISOString();
  const idx = read().findIndex((s) => s.id === submissionId && isActive(s));
  if (idx === -1) return;
  const next = { ...read()[idx]!, deletedAt: now };
  await upsertSubmission(next);
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
}

export async function restoreSubmissionRemote(submissionId: string): Promise<void> {
  const idx = read().findIndex((s) => s.id === submissionId);
  if (idx === -1) return;
  const { deletedAt: _r, ...rest } = read()[idx]!;
  const next = rest;
  await upsertSubmission(next);
  const copy = [...read()];
  copy[idx] = next;
  cache = copy;
  notify();
}

export async function restoreSubmissionsRemote(formId: string): Promise<void> {
  const targets = read().filter((s) => s.formId === formId && isTrashed(s));
  for (const s of targets) {
    const { deletedAt: _r, ...rest } = s;
    await upsertSubmission(rest);
  }
  cache = read().map((s) => {
    if (s.formId !== formId || !isTrashed(s)) return s;
    const { deletedAt: _r, ...rest } = s;
    return rest;
  });
  notify();
}

export async function permanentlyDeleteSubmissionRemote(submissionId: string): Promise<void> {
  await deleteSubmissionRow(submissionId);
  cache = read().filter((s) => s.id !== submissionId);
  notify();
}

export async function emptyTrashRemote(formId?: string): Promise<void> {
  const trashed = read().filter((s) => isTrashed(s) && (!formId || s.formId === formId));
  for (const s of trashed) {
    await deleteSubmissionRow(s.id);
  }
  cache = read().filter((s) => !isTrashed(s) || (formId && s.formId !== formId));
  notify();
}

export async function purgeSubmissionsRemote(formId: string): Promise<void> {
  const toDelete = read().filter((s) => s.formId === formId);
  for (const s of toDelete) {
    await deleteSubmissionRow(s.id);
  }
  cache = read().filter((s) => s.formId !== formId);
  notify();
}

export async function replaceAllSubmissionsRemote(subs: StoredSubmission[]): Promise<void> {
  const existing = read();
  for (const s of existing) {
    await deleteSubmissionRow(s.id);
  }
  for (const s of subs) {
    await upsertSubmission(s);
  }
  cache = [...subs];
  notify();
}

export function probeSubmissionsRemote(): 'ok' | 'corrupt' {
  return hydrated ? 'ok' : 'ok';
}

/** Admin-only: insert submission after preview (local path). Production public uses edge function. */
export async function addSubmissionRemote(
  formId: string,
  answers: Answers,
  meta: SubmitMeta,
): Promise<StoredSubmission> {
  const sub: StoredSubmission = {
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
    },
  };
  await upsertSubmission(sub);
  cache = [sub, ...read()];
  notify();
  return sub;
}
