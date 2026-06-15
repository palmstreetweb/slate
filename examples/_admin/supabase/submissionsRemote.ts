/**
 * Supabase-backed submissions cache + persistence (ADR-028).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { getSupabase } from './client.js';
import { rowToSubmission, submissionToRow } from './mappers.js';

type Listener = (subs: StoredSubmission[]) => void;

let cache: StoredSubmission[] = [];
let hydrated = false;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l([...cache]));
}

export function isSubmissionsHydrated(): boolean {
  return hydrated;
}

export async function hydrateSubmissionsRemote(): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .order('received_at', { ascending: false });
  if (error) throw error;
  cache = (data ?? []).map(rowToSubmission);
  hydrated = true;
  notify();
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
  const supabase = getSupabase();
  const row = submissionToRow(sub);
  const { error } = await supabase.from('submissions').upsert(row);
  if (error) throw error;
}

async function deleteSubmissionRow(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('submissions').delete().eq('id', id);
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
  void upsertSubmission(sub);
  return sub;
}

export function trashSubmissionsRemoteSync(formId?: string): void {
  const now = new Date().toISOString();
  cache = read().map((s) =>
    isActive(s) && (!formId || s.formId === formId) ? { ...s, deletedAt: now } : s,
  );
  notify();
  for (const s of read().filter((x) => isTrashed(x) && x.deletedAt === now)) {
    void upsertSubmission(s);
  }
}

export function trashSubmissionRemoteSync(submissionId: string): void {
  const now = new Date().toISOString();
  cache = read().map((s) =>
    s.id === submissionId && isActive(s) ? { ...s, deletedAt: now } : s,
  );
  notify();
  const sub = read().find((s) => s.id === submissionId);
  if (sub) void upsertSubmission(sub);
}

export function restoreSubmissionRemoteSync(submissionId: string): void {
  cache = read().map((s) => {
    if (s.id !== submissionId) return s;
    const { deletedAt: _r, ...rest } = s;
    return rest;
  });
  notify();
  const sub = read().find((s) => s.id === submissionId);
  if (sub) void upsertSubmission(sub);
}

export function restoreSubmissionsRemoteSync(formId: string): void {
  cache = read().map((s) => {
    if (s.formId !== formId || !isTrashed(s)) return s;
    const { deletedAt: _r, ...rest } = s;
    return rest;
  });
  notify();
  for (const s of read().filter((x) => x.formId === formId && isActive(x))) {
    void upsertSubmission(s);
  }
}

export function permanentlyDeleteSubmissionRemoteSync(submissionId: string): void {
  cache = read().filter((s) => s.id !== submissionId);
  notify();
  void deleteSubmissionRow(submissionId);
}

export function emptyTrashRemoteSync(formId?: string): void {
  const toDelete = read().filter((s) => isTrashed(s) && (!formId || s.formId === formId));
  cache = read().filter((s) => !isTrashed(s) || (formId && s.formId !== formId));
  notify();
  for (const s of toDelete) void deleteSubmissionRow(s.id);
}

export function purgeSubmissionsRemoteSync(formId: string): void {
  const toDelete = read().filter((s) => s.formId === formId);
  cache = read().filter((s) => s.formId !== formId);
  notify();
  for (const s of toDelete) void deleteSubmissionRow(s.id);
}

export function replaceAllSubmissionsRemoteSync(subs: StoredSubmission[]): void {
  const prev = read();
  cache = [...subs];
  notify();
  void (async () => {
    for (const s of prev) await deleteSubmissionRow(s.id);
    for (const s of subs) await upsertSubmission(s);
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
