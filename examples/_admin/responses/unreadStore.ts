/**
 * Per-browser read state for responses (ADR-055). One store behind both the
 * notifications bell and the Responses page, so marking a response read in
 * either clears it in the other — live in this tab through listeners, and in
 * other tabs through the `storage` event. localStorage only; not synced
 * across devices.
 */

import { useSyncExternalStore } from 'react';

/** Every response id the bell has seen, newest first. */
export const KNOWN_KEY = 'slate-admin-known-subs';
/** Response ids not opened yet, newest first. */
export const UNREAD_KEY = 'slate-admin-unread-subs';
export const UNREAD_CAP = 200;
export const KNOWN_CAP = 2000;

type Listener = () => void;
const listeners = new Set<Listener>();

function readRaw(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: ReadonlyArray<string>, cap: number): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids.slice(0, cap)));
  } catch {
    // ignore quota / blocked storage
  }
}

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function readUnread(): string[] {
  return parseIds(readRaw(UNREAD_KEY));
}

/** Replace the unread list (deduped, capped at 200) and tell every listener. */
export function setUnread(ids: ReadonlyArray<string>): void {
  writeIds(UNREAD_KEY, [...new Set(ids)], UNREAD_CAP);
  notify();
}

export function markRead(ids: ReadonlyArray<string>): void {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  const current = readUnread();
  const next = current.filter((id) => !drop.has(id));
  if (next.length === current.length) return;
  setUnread(next);
}

/** Put one response back at the top of the unread list. */
export function markUnread(id: string): void {
  const current = readUnread();
  if (current[0] === id) return;
  setUnread([id, ...current.filter((x) => x !== id)]);
}

export function readKnown(): string[] {
  return parseIds(readRaw(KNOWN_KEY));
}

/** False until the bell has recorded what already existed on first run. */
export function hasKnown(): boolean {
  return Boolean(readRaw(KNOWN_KEY));
}

export function writeKnown(ids: ReadonlyArray<string>): void {
  writeIds(KNOWN_KEY, ids, KNOWN_CAP);
}

/** Same-tab writes plus other tabs' writes. Returns an unsubscribe. */
export function subscribeUnread(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    // key === null means another tab cleared storage.
    if (e.key === UNREAD_KEY || e.key === null) fn();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

const EMPTY: ReadonlySet<string> = new Set();
let snapshot: { raw: string | null; ids: ReadonlySet<string> } = { raw: null, ids: EMPTY };

/** Stable Set per stored value, so React only re-renders on a real change. */
function getSnapshot(): ReadonlySet<string> {
  const raw = readRaw(UNREAD_KEY);
  if (raw !== snapshot.raw) snapshot = { raw, ids: new Set(parseIds(raw)) };
  return snapshot.ids;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

/** Unread response ids across every form, kept live. */
export function useUnread(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeUnread, getSnapshot, getServerSnapshot);
}
