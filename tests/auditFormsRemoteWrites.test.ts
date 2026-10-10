/**
 * Audit fixes (2026-10-09), studio, the cloud form writes:
 *  - B4: unpublish, the closing settings and tracked links roll back when their
 *    write fails, and say "done" only once it landed.
 *  - B9: every form write names its form in the persist events, so an open
 *    editor on another form never takes one as its own.
 *  - B10: a permanent delete forgets the form's responses only once the row is
 *    gone; a delete that fails keeps them with the restored form.
 *  - B13: a create that fails is logged and said, not swallowed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  failUpserts: false,
  failDeletes: false,
  failInserts: false,
  upserts: [] as Array<Record<string, unknown>>,
  dropped: [] as string[],
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => ({
      // 022 (ADR-071): the insert reads the server-assigned slug back.
      insert: (row: { slug?: string }) => ({
        select: () => ({
          single: async () =>
            db.failInserts
              ? { data: null, error: { message: 'TypeError: Failed to fetch' } }
              : { data: { slug: row.slug }, error: null },
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        db.upserts.push(row);
        return db.failUpserts ? { error: { message: 'TypeError: Failed to fetch' } } : { error: null };
      },
      delete: () => ({
        eq: async () =>
          db.failDeletes ? { error: { message: 'TypeError: Failed to fetch' } } : { error: null },
      }),
    }),
  }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({}),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1' }),
}));
vi.mock('../examples/_admin/neon/submissionsRemote.js', () => ({
  dropFormSubmissionsLocal: (formId: string) => db.dropped.push(formId),
}));
vi.mock('../examples/_admin/neon/storageQuotaRemote.js', () => ({
  afterPermanentDelete: () => {},
}));

const remote = await import('../examples/_admin/neon/formsRemote.js');

const schema = {
  brand: { name: 'Pool' },
  theme: 'swiss',
  questions: [{ id: 'q1', type: 'short_text', title: 'Name?' }],
} as unknown as Parameters<typeof remote.createFormRemoteSync>[0]['schema'];

type PersistDetail = { kind: string; formId?: string; title?: string; message?: string };
const events: Array<{ type: string; detail: PersistDetail }> = [];
const onEvent = (e: Event) =>
  events.push({ type: e.type, detail: (e as CustomEvent<PersistDetail>).detail });

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  db.failUpserts = false;
  db.failDeletes = false;
  db.failInserts = false;
  db.upserts = [];
  db.dropped = [];
  events.length = 0;
  window.addEventListener('slate-persist-error', onEvent);
  window.addEventListener('slate-persist-ok', onEvent);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener('slate-persist-error', onEvent);
  window.removeEventListener('slate-persist-ok', onEvent);
  vi.restoreAllMocks();
});

async function liveForm(name = 'Pool sign-up') {
  const created = remote.createFormRemoteSync({ name, schema })!;
  await settle();
  remote.publishFormRemoteSync(created.id);
  await settle();
  events.length = 0;
  return created.id;
}

describe('unpublish (audit B4)', () => {
  it('says Unpublished only once the write landed', async () => {
    const id = await liveForm();
    const onLanded = vi.fn();
    remote.unpublishFormRemoteSync(id, { onLanded });
    expect(remote.getFormRemote(id)?.status).toBe('draft');
    expect(onLanded).not.toHaveBeenCalled();
    await settle();
    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  it('puts "published" back and says so when the write fails', async () => {
    const id = await liveForm();
    db.failUpserts = true;
    const onFail = vi.fn();
    const onLanded = vi.fn();
    remote.unpublishFormRemoteSync(id, { onFail, onLanded });
    expect(remote.getFormRemote(id)?.status).toBe('draft');
    await settle();
    expect(remote.getFormRemote(id)?.status).toBe('published');
    expect(remote.getFormRemote(id)?.publishedSchema).toBeDefined();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onLanded).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['slate-persist-error']);
    expect(events[0]!.detail.title).toBe('Couldn’t unpublish that form');
    expect(events[0]!.detail.formId).toBe(id);
    // A one-off that was put back, not an edit left unsaved.
    expect(remote.hasUnsavedFormEditRemote(id)).toBe(false);
  });
});

describe('closing settings and tracked links (audit B4)', () => {
  it('a closing that fails to save is taken off again, and never said', async () => {
    const id = await liveForm();
    db.failUpserts = true;
    const onLanded = vi.fn();
    const closesAt = '2026-10-09T21:00:00.000Z';
    remote.updateFormRemoteSync(
      id,
      { closesAt, maxResponses: undefined, closedMessage: 'All full.' },
      { rollback: true, failTitle: 'Couldn’t save the closing', onLanded },
    );
    expect(remote.getFormRemote(id)?.closesAt).toBe(closesAt);
    await settle();
    expect(remote.getFormRemote(id)?.closesAt).toBeUndefined();
    expect(remote.getFormRemote(id)?.closedMessage).toBeUndefined();
    expect(onLanded).not.toHaveBeenCalled();
    expect(events[0]!.detail.title).toBe('Couldn’t save the closing');
  });

  it('a closing that lands stays, and is said then', async () => {
    const id = await liveForm();
    const onLanded = vi.fn();
    remote.updateFormRemoteSync(
      id,
      { closesAt: '2026-10-09T21:00:00.000Z' },
      { rollback: true, failTitle: 'Couldn’t save the closing', onLanded },
    );
    await settle();
    expect(remote.getFormRemote(id)?.closesAt).toBe('2026-10-09T21:00:00.000Z');
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(['slate-persist-ok']);
  });

  it('a tracked link that fails to save leaves the list as it was', async () => {
    const id = await liveForm();
    db.failUpserts = true;
    remote.updateFormRemoteSync(
      id,
      { trackedSources: [{ name: 'Mailbox flyer', src: 'mailbox-flyer', createdAt: '' }] },
      { rollback: true, failTitle: 'Couldn’t save that link' },
    );
    expect(remote.getFormRemote(id)?.trackedSources).toHaveLength(1);
    await settle();
    expect(remote.getFormRemote(id)?.trackedSources).toBeUndefined();
  });

  it('a rename typed after a closing that then fails keeps the rename', async () => {
    const id = await liveForm();
    db.failUpserts = true;
    remote.updateFormRemoteSync(
      id,
      { closesAt: '2026-10-09T21:00:00.000Z' },
      { rollback: true, failTitle: 'Couldn’t save the closing' },
    );
    remote.updateFormRemoteSync(id, { name: 'Pool sign-up 2027' });
    await settle();
    expect(remote.getFormRemote(id)?.closesAt).toBeUndefined();
    expect(remote.getFormRemote(id)?.name).toBe('Pool sign-up 2027');
  });
});

describe('persist events name their form (audit B9)', () => {
  it('a create that lands, and one that fails, both carry the form id', async () => {
    const created = remote.createFormRemoteSync({ name: 'Swim', schema })!;
    await settle();
    expect(events).toEqual([
      { type: 'slate-persist-ok', detail: { kind: 'form', formId: created.id } },
    ]);
    events.length = 0;
    db.failInserts = true;
    const failed = remote.createFormRemoteSync({ name: 'Dive', schema })!;
    await settle();
    expect(events[0]!.type).toBe('slate-persist-error');
    expect(events[0]!.detail.formId).toBe(failed.id);
  });

  it('a permanent delete carries the form id too', async () => {
    const id = await liveForm('Gone');
    remote.trashFormRemoteSync(id);
    await settle();
    events.length = 0;
    remote.permanentlyDeleteFormRemoteSync(id);
    await settle();
    expect(events).toEqual([{ type: 'slate-persist-ok', detail: { kind: 'form', formId: id } }]);
  });
});

describe('permanent delete and the form’s responses (audit B10)', () => {
  it('forgets the responses only once the row is gone', async () => {
    const id = await liveForm('Gone');
    remote.trashFormRemoteSync(id);
    await settle();
    remote.permanentlyDeleteFormRemoteSync(id);
    expect(db.dropped).toEqual([]);
    await settle();
    expect(db.dropped).toEqual([id]);
    expect(remote.listAllFormsRemote().some((f) => f.id === id)).toBe(false);
  });

  it('keeps them with the restored form when the delete fails', async () => {
    const id = await liveForm('Kept');
    remote.trashFormRemoteSync(id);
    await settle();
    db.failDeletes = true;
    remote.permanentlyDeleteFormRemoteSync(id);
    await settle();
    expect(db.dropped).toEqual([]);
    expect(remote.listTrashedFormsRemote().some((f) => f.id === id)).toBe(true);
  });
});

describe('a create that fails (audit B13)', () => {
  it('is logged and said, not swallowed', async () => {
    db.failInserts = true;
    const result = await remote.createFormRemote({ name: 'Quiet', schema });
    expect(result).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.title).toBe('Couldn’t create that form');
    expect(console.error).toHaveBeenCalled();
  });
});
