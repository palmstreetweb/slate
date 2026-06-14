/**
 * Submissions store — same shape as before but scoped per formId. All
 * submissions live in one localStorage key with a `formId` field.
 */

import type { Answers, SubmitMeta } from '@/index.js';

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
};

type Listener = (subs: StoredSubmission[]) => void;
const listeners = new Set<Listener>();

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

export function listSubmissions(formId?: string): StoredSubmission[] {
  const all = read();
  return formId ? all.filter((s) => s.formId === formId) : all;
}

export function countSubmissions(formId?: string): number {
  return listSubmissions(formId).length;
}

export function lastSubmissionAt(formId?: string): string | null {
  const subs = listSubmissions(formId);
  return subs.length > 0 ? subs[0]!.receivedAt : null;
}

export function clearSubmissions(formId?: string): void {
  if (!formId) {
    write([]);
    return;
  }
  write(read().filter((s) => s.formId !== formId));
}

export function deleteSubmission(submissionId: string): void {
  write(read().filter((s) => s.id !== submissionId));
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
