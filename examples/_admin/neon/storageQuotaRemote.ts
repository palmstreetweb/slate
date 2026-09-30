/**
 * The signed-in owner's file storage (ADR-067): `storage_quota_status()` over
 * the Data API (021; it reads only the caller's own rows), cached for the
 * dashboard meter, and the purge that asks storagesign to delete this
 * account's files right after a permanent delete. Studio only: the public
 * fill page never imports this module.
 */

import type { StorageQuota } from '../storageQuota.js';
import { getNeon } from './client.js';
import { getStorageSignUrl, hasStorageSignUrl, isNeonConfigured } from './config.js';

type Listener = () => void;

let cache: StorageQuota | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

/** The last numbers the database gave; null until then (the meter stays hidden). */
export function getStorageQuota(): StorageQuota | null {
  return cache;
}

export function subscribeStorageQuota(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets the cached numbers (the fetch below, sign-out, tests, the screenshot pass). */
export function primeStorageQuota(q: StorageQuota | null): void {
  cache = q;
  emit();
}

function toQuota(raw: unknown): StorageQuota | null {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!row) return null;
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
  const q = {
    used: n(row.used_bytes),
    max: n(row.max_bytes),
    pending: n(row.pending_bytes),
    files: n(row.files),
  };
  return Object.values(q).every((v) => Number.isFinite(v) && v >= 0) && q.max > 0 ? q : null;
}

/**
 * Fetch the owner's numbers. Failures keep what was cached: before 021 or a
 * schema-cache refresh the RPC doesn't exist and the meter simply stays hidden.
 */
export function refreshStorageQuota(): Promise<void> {
  if (!isNeonConfigured()) return Promise.resolve();
  inflight ??= (async () => {
    try {
      const { data, error } = await getNeon().rpc('storage_quota_status');
      if (error) return;
      const q = toQuota(data);
      if (q) primeStorageQuota(q);
    } catch {
      // Offline, signed out, or 021 not applied yet.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Ask storagesign to delete this account's files of responses and forms just
 * deleted for good (`op: 'purge'`, Bearer, only the caller's own). A few
 * rounds at most; whatever is left the sweep deletes. Never throws.
 */
async function purgeDeletedFiles(): Promise<void> {
  if (!isNeonConfigured() || !hasStorageSignUrl()) return;
  const { authHeader } = await import('../storageUpload.js');
  for (let round = 0; round < 3; round++) {
    try {
      const res = await fetch(getStorageSignUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ op: 'purge' }),
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => ({}))) as { more?: unknown };
      if (body.more !== true) return;
    } catch {
      return;
    }
  }
}

let afterDeleteTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * After a permanent delete: the bytes are free at once in the database; delete
 * the files and refresh the meter. Debounced so emptying a Trash of 40 is one
 * purge.
 */
export function afterPermanentDelete(): void {
  if (!isNeonConfigured()) return;
  if (afterDeleteTimer) clearTimeout(afterDeleteTimer);
  afterDeleteTimer = setTimeout(() => {
    afterDeleteTimer = null;
    void refreshStorageQuota();
    void purgeDeletedFiles();
  }, 1500);
}
