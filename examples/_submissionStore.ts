/**
 * Tiny submission store for the PSW contact form. Persists to localStorage
 * so submissions survive page reloads during development; emits change
 * events so the inbox view can re-render live when a new submission lands.
 *
 * In production (PSW v2), swap `addSubmission`'s implementation for a
 * `fetch('/api/contact', ...)` call. The API surface (`addSubmission`,
 * `listSubmissions`, `clearSubmissions`, `subscribe`) is what the inbox UI
 * binds against, so the swap is one file.
 */

import type { Answers, SubmitMeta } from '@/index.js';

const STORAGE_KEY = 'psw-contact-submissions';

export type StoredSubmission = {
  id: string;
  receivedAt: string; // ISO
  answers: Answers;
  meta: Pick<SubmitMeta, 'durationMs' | 'questionsVisited' | 'hiddenFields'> & {
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
    // Quota exceeded or private mode — fail silently in dev.
  }
  listeners.forEach((l) => l(subs));
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addSubmission(answers: Answers, meta: SubmitMeta): StoredSubmission {
  const sub: StoredSubmission = {
    id: id(),
    receivedAt: new Date().toISOString(),
    answers,
    meta: {
      startedAt: meta.startedAt.toISOString(),
      completedAt: meta.completedAt.toISOString(),
      durationMs: meta.durationMs,
      questionsVisited: meta.questionsVisited,
      hiddenFields: meta.hiddenFields,
    },
  };
  const all = [sub, ...read()];
  write(all);
  return sub;
}

export function listSubmissions(): StoredSubmission[] {
  return read();
}

export function clearSubmissions(): void {
  write([]);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Cross-tab sync: storage events fire in OTHER tabs/windows.
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
