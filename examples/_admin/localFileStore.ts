/**
 * Browser IndexedDB blob store for Slate admin uploads until a remote backend
 * is configured. Answers store `slate-file://{id}` refs (see fileUploadRef).
 */

import { makeFileUploadRef, type FileUploadMeta } from '@/utils/fileUploadRef.js';

const DB_NAME = 'slate-uploads';
const DB_VERSION = 1;
const STORE = 'files';

type StoredRecord = FileUploadMeta & { blob: Blob };

const metaCache = new Map<string, FileUploadMeta>();

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

export async function saveLocalUpload(file: File): Promise<string> {
  const id = crypto.randomUUID();
  const record: StoredRecord & { id: string } = {
    id,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    blob: file,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STORE).put(record);
  });
  db.close();
  const meta = { name: record.name, size: record.size, mime: record.mime };
  metaCache.set(id, meta);
  return makeFileUploadRef(id);
}

export async function getLocalUploadMeta(ref: string): Promise<FileUploadMeta | null> {
  const id = ref.startsWith('slate-file://') ? ref.slice('slate-file://'.length) : ref;
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
  const id = ref.startsWith('slate-file://') ? ref.slice('slate-file://'.length) : ref;
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
  const id = ref.startsWith('slate-file://') ? ref.slice('slate-file://'.length) : ref;
  return metaCache.get(id) ?? null;
}
