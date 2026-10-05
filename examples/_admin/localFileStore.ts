/**
 * Browser IndexedDB blob store for Slate admin uploads until a remote backend
 * is configured. Answers store `slate-file://{id}` refs (see fileUploadRef).
 *
 * A save that fails says so in plain words (MEDIA-06) — never the browser's
 * own "The quota has been exceeded." — and files a response doesn't keep can
 * be deleted again (MEDIA-19).
 */

import { makeFileUploadRef, type FileUploadMeta } from '@/utils/fileUploadRef.js';
import { FILE_EMPTY } from './fillCopy.js';

const DB_NAME = 'slate-uploads';
const DB_VERSION = 1;
const STORE = 'files';

type StoredRecord = FileUploadMeta & { blob: Blob; savedAt?: number };

const metaCache = new Map<string, FileUploadMeta>();

/** The device is out of room for files. */
export const LOCAL_FULL =
  'This device is out of room for files. Free up some space, then try again.';
/** Saving failed for any other reason (some private windows block storage). */
export const LOCAL_SAVE_FAILED =
  'We couldn’t save that file on this device. Try again, or open the link in another browser.';

function idOf(ref: string): string {
  return ref.startsWith('slate-file://') ? ref.slice('slate-file://'.length) : ref;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/** Plain words for a storage failure; the browser's own text goes to the console. */
function plainSaveError(err: unknown): Error {
  console.error('[slate] saving a file on this device failed', err);
  const name = (err as { name?: unknown } | null)?.name;
  return new Error(name === 'QuotaExceededError' ? LOCAL_FULL : LOCAL_SAVE_FAILED);
}

export async function saveLocalUpload(file: File): Promise<string> {
  if (file.size === 0) throw new Error(FILE_EMPTY);
  const id = crypto.randomUUID();
  const record: StoredRecord & { id: string } = {
    id,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    blob: file,
    savedAt: Date.now(),
  };
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        tx.objectStore(STORE).put(record);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    throw plainSaveError(err);
  }
  const meta = { name: record.name, size: record.size, mime: record.mime };
  metaCache.set(id, meta);
  sweepSoon();
  return makeFileUploadRef(id);
}

/** Every `slate-file://` ref anywhere in an answer value (lists, checklists, voice notes). */
export function localRefsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('slate-file://')) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) localRefsIn(v, into);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) localRefsIn(v, into);
  }
  return into;
}

let sweepQueued = false;

/**
 * Once per page, a few seconds after the first save: in local (no-cloud)
 * mode, delete files no stored response refers to — permanently deleted
 * responses, removed or retaken files, fills nobody sent — once they are a
 * day old (MEDIA-19). Never on the live site, never blocking a save.
 */
function sweepSoon(): void {
  if (sweepQueued) return;
  sweepQueued = true;
  setTimeout(() => {
    void (async () => {
      const { isNeonConfigured } = await import('./neon/config.js');
      if (isNeonConfigured()) return;
      const { listAllSubmissions } = await import('./_submissionStore.js');
      const refs = new Set<string>();
      for (const sub of listAllSubmissions()) localRefsIn(sub.answers, refs);
      await sweepLocalUploads(refs);
    })().catch((err: unknown) => console.warn('[slate] could not tidy files on this device', err));
  }, 5000);
}

/**
 * Delete stored files by ref (MEDIA-19): files a response doesn't keep
 * (removed, retaken, re-recorded), or a response's files once it is
 * permanently deleted. Never throws; a file that is already gone is fine.
 */
export async function deleteLocalUploads(refs: Iterable<string>): Promise<void> {
  const ids = [...new Set([...refs].filter((r) => r.startsWith('slate-file://')).map(idOf))];
  if (!ids.length || typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
        const store = tx.objectStore(STORE);
        for (const id of ids) store.delete(id);
      });
    } finally {
      db.close();
    }
    for (const id of ids) metaCache.delete(id);
  } catch (err) {
    console.warn('[slate] could not delete files on this device', err);
  }
}

/**
 * Delete every stored file no response refers to, once it is older than
 * `minAgeMs` (a fill still in progress in another tab keeps its files).
 * Returns how many were deleted. Never throws.
 */
export async function sweepLocalUploads(
  referenced: ReadonlySet<string>,
  minAgeMs = 24 * 60 * 60 * 1000,
  now = Date.now(),
): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const keep = new Set([...referenced].map(idOf));
  try {
    const db = await openDb();
    try {
      return await new Promise<number>((resolve, reject) => {
        let deleted = 0;
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve(deleted);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB sweep failed'));
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const rec = cursor.value as StoredRecord & { id: string };
          // Files from before `savedAt` existed count as old.
          if (!keep.has(rec.id) && now - (rec.savedAt ?? 0) >= minAgeMs) {
            cursor.delete();
            metaCache.delete(rec.id);
            deleted += 1;
          }
          cursor.continue();
        };
      });
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('[slate] could not tidy files on this device', err);
    return 0;
  }
}

export async function getLocalUploadMeta(ref: string): Promise<FileUploadMeta | null> {
  const id = idOf(ref);
  const cached = metaCache.get(id);
  if (cached) return cached;

  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    const record = await new Promise<(StoredRecord & { id: string }) | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result as (StoredRecord & { id: string }) | undefined);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
      },
    );
    db.close();
    if (!record) return null;
    const meta = { name: record.name, size: record.size, mime: record.mime };
    metaCache.set(id, meta);
    return meta;
  } catch {
    return null;
  }
}

export async function getLocalUploadBlob(ref: string): Promise<Blob | null> {
  const id = idOf(ref);
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    const record = await new Promise<(StoredRecord & { id: string }) | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result as (StoredRecord & { id: string }) | undefined);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
      },
    );
    db.close();
    return record?.blob ?? null;
  } catch {
    return null;
  }
}

/** Sync label when meta was cached during this session. */
export function peekLocalUploadMeta(ref: string): FileUploadMeta | null {
  return metaCache.get(idOf(ref)) ?? null;
}
