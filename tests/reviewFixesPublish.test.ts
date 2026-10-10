/**
 * Review fixes, studio (2026-10-05): a publish tells its caller when its write
 * has landed — or not — even when an edit made right after it merged into the
 * same write (STU-5); a republish that fails says the earlier version is still
 * live (STU-6, COPY-R1); and an edit whose write failed is kept, and sent
 * again, instead of a refresh quietly dropping it (STU-8).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { error: unknown };
const db = vi.hoisted(() => ({
  /** Upserts wait here while `hold` is on, until the test settles them. */
  hold: false,
  pending: [] as Array<{ row: Record<string, unknown>; settle: (r: Result) => void }>,
  fail: false,
  upserts: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
}));

const FAILED = { message: 'TypeError: Failed to fetch' };

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      select: () => ({ order: async () => ({ data: db.rows, error: null }) }),
      // 022: the insert reads the assigned slug back.
      insert: (row: { slug: string }) => ({
        select: () => ({ single: async () => ({ data: { slug: row.slug }, error: null }) }),
      }),
      upsert: (row: Record<string, unknown>) => {
        db.upserts.push(row);
        if (db.hold) {
          return new Promise<Result>((settle) => db.pending.push({ row, settle }));
        }
        return Promise.resolve({ error: db.fail ? FAILED : null });
      },
    }),
    rpc: async () => ({ data: 'owner-1', error: null }),
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({}),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1' }),
}));

const remote = await import('../examples/_admin/neon/formsRemote.js');

const ROW = {
  id: 'f_1',
  name: 'Pool care',
  slug: '23456789',
  schema: { brand: { name: 'Pool' }, theme: 'swiss', questions: [] },
  published_schema: null,
  status: 'draft',
  deleted_at: null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
  fill_locked: false,
};

const events: Array<{ type: string; detail: Record<string, unknown> }> = [];
const listen = (type: string) => (e: Event) =>
  events.push({ type, detail: (e as CustomEvent<Record<string, unknown>>).detail });
const onPublishError = listen('publish-error');
const onPersistError = listen('persist-error');
const onPersistOk = listen('persist-ok');

/** Let queued writes run. */
const flush = () =>
  new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

/** Settle the oldest held upsert. */
async function settleNext(ok: boolean) {
  await vi.waitFor(() => expect(db.pending.length).toBeGreaterThan(0));
  db.pending.shift()!.settle({ error: ok ? null : FAILED });
  await flush();
}

beforeEach(async () => {
  db.hold = false;
  db.pending = [];
  db.fail = false;
  db.upserts = [];
  db.rows = [ROW];
  events.length = 0;
  remote.clearFormsRemoteCache();
  await remote.hydrateFormsRemote({ soft: true });
  window.addEventListener('slate-publish-error', onPublishError);
  window.addEventListener('slate-persist-error', onPersistError);
  window.addEventListener('slate-persist-ok', onPersistOk);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('slate-publish-error', onPublishError);
  window.removeEventListener('slate-persist-error', onPersistError);
  window.removeEventListener('slate-persist-ok', onPersistOk);
  vi.restoreAllMocks();
});

describe('a publish hears how its write went (STU-5)', () => {
  it('a publish that lands calls onLanded, not onFail', async () => {
    const onFail = vi.fn();
    const onLanded = vi.fn();
    remote.publishFormRemoteSync('f_1', onFail, onLanded);
    expect(onLanded).not.toHaveBeenCalled();
    await flush();
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('a publish that fails calls onFail, never onLanded', async () => {
    db.fail = true;
    const onFail = vi.fn();
    const onLanded = vi.fn();
    remote.publishFormRemoteSync('f_1', onFail, onLanded);
    await flush();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onLanded).not.toHaveBeenCalled();
    expect(remote.getFormRemote('f_1')?.status).toBe('draft');
  });

  it('merged into an edit’s write that fails: rolled back, said, and onFail runs', async () => {
    db.hold = true;
    // A save is on its way when Publish is pressed; then the owner types again,
    // and that edit replaces the queued publish write.
    remote.updateFormRemoteSync('f_1', { name: 'Pool care 2' });
    await vi.waitFor(() => expect(db.pending).toHaveLength(1));
    const onFail = vi.fn();
    const onLanded = vi.fn();
    remote.publishFormRemoteSync('f_1', onFail, onLanded);
    remote.updateFormRemoteSync('f_1', { name: 'Pool care 3' });
    await settleNext(true); // the first save lands
    await settleNext(false); // the edit that carries the publish fails
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onLanded).not.toHaveBeenCalled();
    // Not live: the publish fields go back, the newer edit stays.
    const form = remote.getFormRemote('f_1')!;
    expect(form.status).toBe('draft');
    expect(form.publishedSchema).toBeUndefined();
    expect(form.name).toBe('Pool care 3');
    expect(events.map((e) => e.type)).toEqual(['persist-ok', 'publish-error', 'persist-error']);
    expect(events[1]!.detail).toEqual({ formId: 'f_1', wasLive: false });
  });

  it('merged into an edit’s write that lands: onLanded runs', async () => {
    db.hold = true;
    remote.updateFormRemoteSync('f_1', { name: 'Pool care 2' });
    await vi.waitFor(() => expect(db.pending).toHaveLength(1));
    const onLanded = vi.fn();
    remote.publishFormRemoteSync('f_1', undefined, onLanded);
    remote.updateFormRemoteSync('f_1', { name: 'Pool care 3' });
    await settleNext(true);
    expect(onLanded).not.toHaveBeenCalled();
    await settleNext(true);
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(db.upserts.at(-1)).toMatchObject({ status: 'published', name: 'Pool care 3' });
    expect(remote.getFormRemote('f_1')?.status).toBe('published');
  });
});

describe('a republish that fails (STU-6, COPY-R1)', () => {
  it('tells the shell the earlier version is still live', async () => {
    remote.publishFormRemoteSync('f_1');
    await flush();
    remote.updateFormRemoteSync('f_1', { name: 'Pool care, new' });
    await flush();
    events.length = 0;
    db.fail = true;
    remote.publishFormRemoteSync('f_1');
    await flush();
    const failed = events.find((e) => e.type === 'publish-error')!;
    expect(failed.detail).toEqual({ formId: 'f_1', wasLive: true });
    // The earlier version is what the cache shows again: still published.
    expect(remote.getFormRemote('f_1')?.status).toBe('published');
  });
});

describe('an edit whose write failed is kept and sent again (STU-8)', () => {
  it('a refresh keeps the unsaved edit; the next write that lands clears it', async () => {
    db.fail = true;
    remote.updateFormRemoteSync('f_1', { name: 'Typed offline' });
    await flush();
    expect(remote.hasUnsavedFormEditRemote('f_1')).toBe(true);
    // The server still has the old row; a refresh must not put it back over the edit.
    await remote.refreshFormsRemote();
    expect(remote.getFormRemote('f_1')?.name).toBe('Typed offline');
    db.fail = false;
    remote.updateFormRemoteSync('f_1', { name: 'Typed offline' });
    await flush();
    expect(remote.hasUnsavedFormEditRemote('f_1')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'persist-ok', detail: { kind: 'form', formId: 'f_1' } });
  });

  it('a trash that failed put itself back: nothing is left unsaved', async () => {
    db.fail = true;
    remote.trashFormRemoteSync('f_1');
    await flush();
    expect(remote.getFormRemote('f_1')).not.toBeNull();
    expect(remote.hasUnsavedFormEditRemote('f_1')).toBe(false);
  });

  it('a form deleted elsewhere doesn’t come back for an unsaved edit', async () => {
    db.fail = true;
    remote.updateFormRemoteSync('f_1', { name: 'Typed offline' });
    await flush();
    db.rows = [{ ...ROW, id: 'f_2', slug: '34567890' }];
    await remote.refreshFormsRemote();
    expect(remote.getFormRemote('f_1')).toBeNull();
    expect(remote.hasUnsavedFormEditRemote('f_1')).toBe(false);
  });

  it('coming back online sends the unsaved edit again', async () => {
    db.fail = true;
    remote.updateFormRemoteSync('f_1', { name: 'Typed offline' });
    await flush();
    db.fail = false;
    const before = db.upserts.length;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(db.upserts.length).toBe(before + 1);
    expect(db.upserts.at(-1)).toMatchObject({ name: 'Typed offline' });
    expect(remote.hasUnsavedFormEditRemote('f_1')).toBe(false);
  });
});
