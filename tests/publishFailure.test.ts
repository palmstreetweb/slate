/**
 * COPY-10: a cloud publish is optimistic. When its write never reaches the
 * server, the form goes back to how it was (not live), the shell is told with
 * `slate-publish-error` before the save error, and the caller's `onFail` runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ failUpserts: false, upserts: 0 }));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      upsert: async () => {
        db.upserts += 1;
        return db.failUpserts
          ? {
              error: {
                message: 'TypeError: Failed to fetch',
                details: 'at write (formsRemote.ts:304)',
              },
            }
          : { error: null };
      },
    }),
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({}),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1' }),
}));

const remote = await import('../examples/_admin/neon/formsRemote.js');

const schema = {
  brand: { name: 'Pool' },
  theme: 'swiss',
  questions: [{ id: 'q1', type: 'short_text', title: 'Name?' }],
} as unknown as Parameters<typeof remote.createFormRemoteSync>[0]['schema'];

const events: string[] = [];
const onPublishError = () => events.push('publish-error');
const onPersistError = () => events.push('persist-error');

/** Let the queued write chain settle. */
const settle = () =>
  new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  db.failUpserts = false;
  db.upserts = 0;
  events.length = 0;
  window.addEventListener('slate-publish-error', onPublishError);
  window.addEventListener('slate-persist-error', onPersistError);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('slate-publish-error', onPublishError);
  window.removeEventListener('slate-persist-error', onPersistError);
  vi.restoreAllMocks();
});

describe('a publish that never lands (COPY-10)', () => {
  it('rolls back to the draft, tells the shell first, and calls onFail', async () => {
    const created = remote.createFormRemoteSync({ name: 'Pool sign-up', schema })!;
    await settle();
    db.failUpserts = true;
    const onFail = vi.fn();
    const optimistic = remote.publishFormRemoteSync(created.id, onFail);
    expect(optimistic?.status).toBe('published');
    await settle();
    expect(db.upserts).toBe(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(remote.getFormRemote(created.id)?.status).toBe('draft');
    expect(remote.getFormRemote(created.id)?.publishedSchema).toBeUndefined();
    expect(events).toEqual(['publish-error', 'persist-error']);
  });

  it('a publish that lands stays published and says nothing', async () => {
    const created = remote.createFormRemoteSync({ name: 'Swim', schema })!;
    await settle();
    const onFail = vi.fn();
    remote.publishFormRemoteSync(created.id, onFail);
    await settle();
    expect(onFail).not.toHaveBeenCalled();
    expect(remote.getFormRemote(created.id)?.status).toBe('published');
    expect(events).toEqual([]);
  });
});
