/**
 * Submissions store — localStorage or Supabase (ADR-028). All submissions
 * are scoped per formId. Deleted responses are soft-deleted (`deletedAt`).
 */

import type { Answers, SubmitMeta } from '@/index.js';
import { isSupabaseConfigured } from './supabase/env.js';
import { isStoresHydrated } from './supabase/hydrate.js';
import * as remote from './supabase/submissionsRemote.js';

const STORAGE_KEY = 'slate-submissions';

export type StoredSubmission = {
  id: string;
  formId: string;
  receivedAt: string;
  answers: Answers;
  meta: Pick<SubmitMeta, 'durationMs' | 'questionsVisited' | 'hiddenFields' | 'score'> & {
    startedAt: string;
    completedAt: string;
  };
  /** ISO timestamp when moved to trash; omitted while active. */
  deletedAt?: string;
};

type Listener = (subs: StoredSubmission[]) => void;
const listeners = new Set<Listener>();

function useRemote(): boolean {
  return isSupabaseConfigured() && isStoresHydrated();
}

function read(): StoredSubmission[] {
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

function isActive(sub: StoredSubmission): boolean {
  return !sub.deletedAt;
}

function isTrashed(sub: StoredSubmission): boolean {
  return Boolean(sub.deletedAt);
}

export function probeSubmissionsStorage(): 'ok' | 'corrupt' {
  if (useRemote()) return remote.probeSubmissionsRemote();
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

export function resetSubmissionsStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignored
  }
  listeners.forEach((l) => l([]));
}

/** Replace all stored submissions (backup restore). */
export function replaceAllSubmissions(subs: StoredSubmission[]): void {
  if (useRemote()) {
    remote.replaceAllSubmissionsRemoteSync(subs);
    return;
  }
  write(subs);
}

function write(subs: StoredSubmission[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch {
    // ignored
  }
  listeners.forEach((l) => l(subs));
}

function makeId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function addSubmission(formId: string, answers: Answers, meta: SubmitMeta): StoredSubmission {
  if (useRemote()) return remote.addSubmissionRemoteSync(formId, answers, meta);
  const sub: StoredSubmission = {
    id: makeId(),
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
  write([sub, ...read()]);
  return sub;
}

/** Active responses only (not in trash). */
export function listSubmissions(formId?: string): StoredSubmission[] {
  if (useRemote()) return remote.listSubmissionsRemote(formId);
  const all = read().filter(isActive);
  return formId ? all.filter((s) => s.formId === formId) : all;
}

/** All submissions including trash (backup export). */
export function listAllSubmissions(): StoredSubmission[] {
  if (useRemote()) return remote.listAllSubmissionsRemote();
  return read();
}

/** Trashed responses only. */
export function listTrashedSubmissions(formId?: string): StoredSubmission[] {
  if (useRemote()) return remote.listTrashedSubmissionsRemote(formId);
  const trashed = read().filter(isTrashed);
  return formId ? trashed.filter((s) => s.formId === formId) : trashed;
}

export function countSubmissions(formId?: string): number {
  if (useRemote()) return remote.countSubmissionsRemote(formId);
  return listSubmissions(formId).length;
}

export function countTrashedSubmissions(formId?: string): number {
  return listTrashedSubmissions(formId).length;
}

export function lastSubmissionAt(formId?: string): string | null {
  if (useRemote()) return remote.lastSubmissionAtRemote(formId);
  const subs = listSubmissions(formId);
  return subs.length > 0 ? subs[0]!.receivedAt : null;
}

function trashAt(): string {
  return new Date().toISOString();
}

/** Move active responses to trash. */
export function trashSubmissions(formId?: string): void {
  if (useRemote()) {
    remote.trashSubmissionsRemoteSync(formId);
    return;
  }
  const now = trashAt();
  if (!formId) {
    write(read().map((s) => (isActive(s) ? { ...s, deletedAt: now } : s)));
    return;
  }
  write(
    read().map((s) => (s.formId === formId && isActive(s) ? { ...s, deletedAt: now } : s)),
  );
}

/** @deprecated Use trashSubmissions */
export function clearSubmissions(formId?: string): void {
  trashSubmissions(formId);
}

export function trashSubmission(submissionId: string): void {
  if (useRemote()) {
    remote.trashSubmissionRemoteSync(submissionId);
    return;
  }
  const now = trashAt();
  write(
    read().map((s) => (s.id === submissionId && isActive(s) ? { ...s, deletedAt: now } : s)),
  );
}

/** @deprecated Use trashSubmission */
export function deleteSubmission(submissionId: string): void {
  trashSubmission(submissionId);
}

export function restoreSubmission(submissionId: string): void {
  if (useRemote()) {
    remote.restoreSubmissionRemoteSync(submissionId);
    return;
  }
  write(
    read().map((s) => {
      if (s.id !== submissionId) return s;
      const { deletedAt: _removed, ...rest } = s;
      return rest;
    }),
  );
}

export function restoreSubmissions(formId: string): void {
  if (useRemote()) {
    remote.restoreSubmissionsRemoteSync(formId);
    return;
  }
  write(
    read().map((s) => {
      if (s.formId !== formId || !isTrashed(s)) return s;
      const { deletedAt: _removed, ...rest } = s;
      return rest;
    }),
  );
}

export function permanentlyDeleteSubmission(submissionId: string): void {
  if (useRemote()) {
    remote.permanentlyDeleteSubmissionRemoteSync(submissionId);
    return;
  }
  write(read().filter((s) => s.id !== submissionId));
}

export function emptyTrash(formId?: string): void {
  if (useRemote()) {
    remote.emptyTrashRemoteSync(formId);
    return;
  }
  if (!formId) {
    write(read().filter(isActive));
    return;
  }
  write(read().filter((s) => s.formId !== formId || isActive(s)));
}

/** Permanently remove every submission for a form (active + trash). Used when deleting a form. */
export function purgeSubmissions(formId: string): void {
  if (useRemote()) {
    remote.purgeSubmissionsRemoteSync(formId);
    return;
  }
  write(read().filter((s) => s.formId !== formId));
}

export function subscribe(listener: Listener): () => void {
  if (useRemote()) return remote.subscribeSubmissionsRemote(listener);
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
