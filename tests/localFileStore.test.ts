import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QA pass: a file saved on the device (offline studio, portable links) that
// can't be saved says so plainly (MEDIA-06), and files nothing keeps can be
// deleted again (MEDIA-19).

import {
  LOCAL_FULL,
  LOCAL_SAVE_FAILED,
  deleteLocalUploads,
  localRefsIn,
  saveLocalUpload,
  sweepLocalUploads,
} from '../examples/_admin/localFileStore.js';
import { FILE_EMPTY } from '../examples/_admin/fillCopy.js';

type Rec = { id: string; savedAt?: number };

/** Just enough IndexedDB for localFileStore: one store, put / delete / get / a cursor. */
function fakeIndexedDb(opts: { putError?: { name: string; message: string } } = {}) {
  const data = new Map<string, Rec>();
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction() {
      let busy = 0;
      const tx: Record<string, unknown> & {
        oncomplete?: () => void;
        onerror?: () => void;
        error?: unknown;
      } = {};
      const settle = () => setTimeout(() => (busy === 0 ? tx.oncomplete?.() : undefined));
      tx.objectStore = () => ({
        put(rec: Rec) {
          if (opts.putError) {
            setTimeout(() => {
              tx.error = opts.putError;
              tx.onerror?.();
            });
            return;
          }
          data.set(rec.id, rec);
        },
        delete(id: string) {
          data.delete(id);
        },
        get(id: string) {
          const req: { result?: Rec; onsuccess?: () => void } = {};
          busy += 1;
          setTimeout(() => {
            req.result = data.get(id);
            req.onsuccess?.();
            busy -= 1;
            settle();
          });
          return req;
        },
        openCursor() {
          const req: { result: unknown; onsuccess?: () => void } = { result: null };
          const items = [...data.values()];
          let i = 0;
          busy += 1;
          const step = () => {
            if (i >= items.length) {
              req.result = null;
              req.onsuccess?.();
              busy -= 1;
              settle();
              return;
            }
            const rec = items[i]!;
            req.result = {
              value: rec,
              delete: () => data.delete(rec.id),
              continue: () => {
                i += 1;
                setTimeout(step);
              },
            };
            req.onsuccess?.();
          };
          setTimeout(step);
          return req;
        },
      });
      if (!opts.putError) settle();
      return tx;
    },
  };
  return {
    data,
    api: {
      open() {
        const req: { result?: unknown; onsuccess?: () => void } = {};
        setTimeout(() => {
          req.result = db;
          req.onsuccess?.();
        });
        return req;
      },
    },
  };
}

const file = (body = 'hello', name = 'note.txt') => new File([body], name, { type: 'text/plain' });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saving on the device (MEDIA-06)', () => {
  it('a full device reads as plain copy, not “The quota has been exceeded.”', async () => {
    vi.stubGlobal(
      'indexedDB',
      fakeIndexedDb({ putError: { name: 'QuotaExceededError', message: 'The quota has been exceeded.' } })
        .api,
    );
    await expect(saveLocalUpload(file())).rejects.toThrow(LOCAL_FULL);
  });

  it('a blocked store (some private windows) reads as plain copy', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        throw Object.assign(new Error('A mutation operation was attempted on a database that did not allow mutations.'), {
          name: 'InvalidStateError',
        });
      },
    });
    await expect(saveLocalUpload(file())).rejects.toThrow(LOCAL_SAVE_FAILED);
  });

  it('an empty file is refused with words', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDb().api);
    await expect(saveLocalUpload(file(''))).rejects.toThrow(FILE_EMPTY);
  });
});

describe('deleting files nothing keeps (MEDIA-19)', () => {
  it('deleteLocalUploads removes saved files by ref', async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal('indexedDB', idb.api);
    const a = await saveLocalUpload(file('a', 'a.txt'));
    const b = await saveLocalUpload(file('b', 'b.txt'));
    expect(idb.data.size).toBe(2);
    await deleteLocalUploads([a, 'https://elsewhere.example/x']);
    expect([...idb.data.keys()]).toEqual([b.slice('slate-file://'.length)]);
  });

  it('the sweep deletes day-old files no response refers to, and keeps the rest', async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal('indexedDB', idb.api);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    idb.data.set('kept', { id: 'kept', savedAt: now - 2 * day });
    idb.data.set('orphan', { id: 'orphan', savedAt: now - 2 * day });
    idb.data.set('fresh', { id: 'fresh', savedAt: now - 1000 });
    idb.data.set('legacy', { id: 'legacy' });
    const deleted = await sweepLocalUploads(new Set(['slate-file://kept']), day, now);
    expect(deleted).toBe(2);
    expect([...idb.data.keys()].sort()).toEqual(['fresh', 'kept']);
  });

  it('localRefsIn finds refs in lists, checklists and voice notes', () => {
    const refs = localRefsIn({
      docs: ['slate-file://1', 'slate-file://2'],
      shots: { front: 'slate-file://3' },
      voice: { audio: 'slate-file://4', sec: '3' },
      name: 'Ada',
    });
    expect([...refs].sort()).toEqual(['slate-file://1', 'slate-file://2', 'slate-file://3', 'slate-file://4']);
  });
});
