/**
 * Audit fixes (2026-10-09), studio B1: a background refresh (the 60 s poll, a
 * tab-return) that overlaps a save must not put the server's older row over
 * the owner's edit in the cache. The editor seeds from the cache when it
 * reopens, so a stale cache row turned the next keystroke into a write of the
 * old content over the saved one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string; updated_at: string };

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  upserts: [] as Row[],
  /** While set, every select waits here until the test releases it. */
  heldSelects: [] as Array<() => void>,
  holdSelects: false,
  /** While set, every upsert waits here until the test releases it. */
  heldUpserts: [] as Array<() => void>,
  holdUpserts: false,
}));

vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ ok: true }),
  waitForAuthReady: async () => ({ ok: true, authUid: 'owner-1' }),
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    rpc: async () => ({ data: 'owner-1', error: null }),
    from: () => ({
      select: () => ({
        order: async () => {
          if (db.holdSelects) {
            await new Promise<void>((release) => db.heldSelects.push(release));
          }
          // What the server held when the request was answered.
          return { data: db.rows.map((r) => ({ ...r })), error: null };
        },
      }),
      upsert: async (row: Row) => {
        if (db.holdUpserts) {
          await new Promise<void>((release) => db.heldUpserts.push(release));
        }
        db.upserts.push(row);
        db.rows = [row, ...db.rows.filter((r) => r.id !== row.id)];
        return { error: null };
      },
      insert: async (row: Row) => {
        db.rows = [row, ...db.rows];
        return { error: null };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

const schema = (title: string) => ({
  brand: { name: 'Pool' },
  theme: 'swiss',
  questions: [{ id: 'q1', type: 'short_text', title }],
});

const serverRow = (name: string, title: string): Row => ({
  id: 'f1',
  name,
  slug: '12345678',
  schema: schema(title),
  published_schema: null,
  status: 'draft',
  owner_id: 'owner-1',
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
  deleted_at: null,
  fill_locked: false,
  published_name: null,
  closes_at: null,
  max_responses: null,
  closed_message: null,
  tracked_sources: null,
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

async function load() {
  vi.resetModules();
  return import('../examples/_admin/neon/formsRemote.js');
}

beforeEach(() => {
  db.rows = [serverRow('Pool sign-up', 'Name?')];
  db.upserts = [];
  db.heldSelects = [];
  db.heldUpserts = [];
  db.holdSelects = false;
  db.holdUpserts = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a refresh that overlaps a save (audit B1)', () => {
  it('keeps the edit while its write is still in flight when the older row arrives', async () => {
    const remote = await load();
    await remote.hydrateFormsRemote({ soft: true });
    expect(remote.getFormRemote('f1')?.name).toBe('Pool sign-up');

    // The poll's GET goes out…
    db.holdSelects = true;
    const refresh = remote.refreshFormsRemote();
    await tick();
    expect(db.heldSelects).toHaveLength(1);

    // …then the owner types; the save starts and hangs on the network.
    db.holdUpserts = true;
    remote.updateFormRemoteSync('f1', { name: 'Pool sign-up (edited)' });
    await settle();
    expect(db.heldUpserts).toHaveLength(1);

    // The GET answers with the row as it was before the save.
    db.heldSelects[0]!();
    await refresh;
    expect(remote.getFormRemote('f1')?.name).toBe('Pool sign-up (edited)');

    // The save lands; the cache still holds what the server now has.
    db.heldUpserts[0]!();
    await settle();
    expect(db.upserts.map((r) => r.name)).toEqual(['Pool sign-up (edited)']);
    expect(remote.getFormRemote('f1')?.name).toBe('Pool sign-up (edited)');
  });

  it('keeps the edit when its write landed after the GET was sent but before it answered', async () => {
    const remote = await load();
    await remote.hydrateFormsRemote({ soft: true });

    db.holdSelects = true;
    const refresh = remote.refreshFormsRemote();
    await tick();
    // The GET is in flight; the server reads the old row for it now.
    const answered = db.rows.map((r) => ({ ...r }));

    remote.updateFormRemoteSync('f1', { name: 'Pool sign-up (edited)' });
    await settle();
    expect(db.upserts).toHaveLength(1);
    expect(db.rows[0]!.name).toBe('Pool sign-up (edited)');

    // The GET's answer is the older read.
    db.rows = answered;
    db.heldSelects[0]!();
    await refresh;
    expect(remote.getFormRemote('f1')?.name).toBe('Pool sign-up (edited)');
  });

  it('still takes a change made on another device when nothing is being saved here', async () => {
    const remote = await load();
    await remote.hydrateFormsRemote({ soft: true });
    db.rows = [{ ...serverRow('Renamed elsewhere', 'Name?'), updated_at: '2026-10-02T10:00:00.000Z' }];
    await remote.refreshFormsRemote();
    expect(remote.getFormRemote('f1')?.name).toBe('Renamed elsewhere');
  });

  it('takes the other device’s change on the next refresh after a save here has settled', async () => {
    const remote = await load();
    await remote.hydrateFormsRemote({ soft: true });
    remote.updateFormRemoteSync('f1', { name: 'Edited here' });
    await settle();
    // A later edit elsewhere, read by a GET that started after the save landed.
    db.rows = [{ ...serverRow('Edited elsewhere later', 'Name?'), updated_at: '2026-10-03T10:00:00.000Z' }];
    await new Promise((r) => setTimeout(r, 5));
    await remote.refreshFormsRemote();
    expect(remote.getFormRemote('f1')?.name).toBe('Edited elsewhere later');
  });
});
