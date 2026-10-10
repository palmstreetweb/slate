/**
 * Audit fixes (2026-10-09), studio B3 + B8: a response write that fails puts
 * back only the rows it changed, never every newer local change; and a poll
 * that lands while a trash is on the wire doesn't bring the row back.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string;
  form_id: string;
  answers: Record<string, unknown>;
  meta: Record<string, unknown>;
  received_at: string;
  deleted_at: string | null;
};

const db = vi.hoisted(() => ({
  table: [] as Row[],
  calls: [] as string[],
  /** Writes whose description matches wait here until the test releases them. */
  hold: null as null | { match: (desc: string) => boolean; fail: boolean },
  held: [] as Array<() => void>,
}));

vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ ok: true }),
  waitForAuthReady: async () => ({ ok: true }),
}));

vi.mock('../examples/_admin/neon/client.js', () => ({
  getNeon: () => ({
    from: () => {
      const st = {
        op: 'select',
        cols: '*',
        filters: [] as Array<{ desc: string; test: (r: Row) => boolean }>,
        limit: Infinity,
        from: 0,
        to: Infinity,
        payload: null as unknown,
      };
      const add = (desc: string, test: (r: Row) => boolean) => {
        st.filters.push({ desc, test });
        return b;
      };
      const b = {
        select: (cols: string) => ((st.cols = cols), b),
        update: (p: unknown) => ((st.op = 'update'), (st.payload = p), b),
        delete: () => ((st.op = 'delete'), b),
        insert: (p: unknown) => ((st.op = 'insert'), (st.payload = p), b),
        eq: (c: keyof Row, v: unknown) => add(`${c}=${String(v)}`, (r) => r[c] === v),
        is: (c: keyof Row, v: unknown) => add(`${c} is ${String(v)}`, (r) => (r[c] ?? null) === v),
        not: (c: keyof Row, _op: string, v: unknown) =>
          add(`${c} not ${String(v)}`, (r) => (r[c] ?? null) !== v),
        in: (c: keyof Row, vs: unknown[]) => add(`${c} in ${vs.length}`, (r) => vs.includes(r[c])),
        gte: (c: keyof Row, v: string) => add(`${c}>=`, (r) => String(r[c]) >= v),
        order: () => b,
        limit: (n: number) => ((st.limit = n), b),
        range: (f: number, t: number) => ((st.from = f), (st.to = t), b),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(run).then(res, rej),
      };
      async function run() {
        const desc = `${st.op} [${st.filters.map((f) => f.desc).join(', ')}]`;
        db.calls.push(desc);
        let fail = false;
        if (db.hold && st.op !== 'select' && db.hold.match(desc)) {
          fail = db.hold.fail;
          db.hold = null;
          await new Promise<void>((release) => db.held.push(release));
        }
        if (fail) return { data: null, error: { message: 'boom', code: 'XX000' } };
        const hit = db.table.filter((r) => st.filters.every((f) => f.test(r)));
        if (st.op === 'select') {
          const rows = hit
            .sort((a, z) =>
              a.received_at === z.received_at
                ? a.id < z.id
                  ? 1
                  : -1
                : a.received_at < z.received_at
                  ? 1
                  : -1,
            )
            .slice(st.from, st.to + 1)
            .slice(0, st.limit)
            .map((r) =>
              st.cols === '*'
                ? { ...r }
                : Object.fromEntries(st.cols.split(',').map((c) => [c, r[c as keyof Row]])),
            );
          return { data: rows, error: null };
        }
        if (st.op === 'update') {
          for (const r of hit) Object.assign(r, st.payload);
          return { data: null, error: null };
        }
        if (st.op === 'delete') {
          db.table = db.table.filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        const rows = (Array.isArray(st.payload) ? st.payload : [st.payload]) as Row[];
        db.table.push(...rows.map((r) => ({ deleted_at: null, ...r })));
        return { data: null, error: null };
      }
      return b;
    },
  }),
}));

const iso = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 9, 9, 12, 0) - minutesAgo * 60_000).toISOString();
const row = (id: string, formId: string, minutesAgo: number, deleted = false): Row => ({
  id,
  form_id: formId,
  answers: { name: `person ${id}` },
  meta: { startedAt: '', completedAt: '', durationMs: 1000, questionsVisited: [], hiddenFields: {} },
  received_at: iso(minutesAgo),
  deleted_at: deleted ? iso(0) : null,
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

async function load() {
  vi.resetModules();
  return import('../examples/_admin/neon/submissionsRemote.js');
}

beforeEach(() => {
  db.calls = [];
  db.hold = null;
  db.held = [];
  db.table = [];
  for (let i = 0; i < 5; i++) db.table.push(row(`a${i}`, 'A', i + 10));
  for (let i = 0; i < 3; i++) db.table.push(row(`b${i}`, 'B', 100 + i));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a failed write puts back only what it changed (audit B3)', () => {
  it('a trash that fails late leaves a later trash that landed in the trash', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();

    db.hold = { match: (d) => d.includes('id=a0'), fail: true };
    r.trashSubmissionRemoteSync('a0');
    await tick();
    expect(db.held).toHaveLength(1);
    // Meanwhile the owner trashes a second response; that write lands.
    r.trashSubmissionRemoteSync('a1');
    await settle();
    expect(db.table.find((x) => x.id === 'a1')!.deleted_at).not.toBeNull();
    expect(r.countSubmissionsRemote('A')).toBe(3);

    // The first write fails: a0 comes back; a1 stays in the trash, as on the server.
    db.held[0]!();
    await settle();
    expect(r.getSubmissionRemote('a0')?.deletedAt).toBeUndefined();
    expect(r.getSubmissionRemote('a1')?.deletedAt).toBeDefined();
    expect(r.countSubmissionsRemote('A')).toBe(4);
    expect(r.countTrashedSubmissionsRemote('A')).toBe(1);
  });

  it('a trash that fails late keeps the rows a poll brought in meanwhile', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();

    db.hold = { match: (d) => d.includes('id=a0'), fail: true };
    r.trashSubmissionRemoteSync('a0');
    await tick();
    // A new response arrives and the poll picks it up while the write is out.
    db.table.push(row('new1', 'B', 1));
    await r.refreshSubmissionsRemote();
    expect(r.getSubmissionRemote('new1')).toBeDefined();

    db.held[0]!();
    await settle();
    expect(r.getSubmissionRemote('a0')?.deletedAt).toBeUndefined();
    expect(r.getSubmissionRemote('new1')).toBeDefined();
    expect(r.countSubmissionsRemote('B')).toBe(4);
  });

  it('a roster move patched while an empty-trash was out survives its failure', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    r.trashSubmissionRemoteSync('b0');
    await settle();

    db.hold = { match: (d) => d.startsWith('delete'), fail: true };
    r.emptyTrashRemoteSync('B');
    await tick();
    r.patchAnswerRemote('a2', 'slot', 'afternoon');
    db.held[0]!();
    await settle();
    // b0 is back in the trash (the delete failed); a2's new answer is still there.
    expect(r.getSubmissionRemote('b0')?.deletedAt).toBeDefined();
    expect(r.getSubmissionRemote('a2')?.answers).toMatchObject({ slot: 'afternoon' });
  });

  it('a failed write still puts its own change back when nothing else happened', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    db.hold = { match: () => true, fail: true };
    r.trashSubmissionsRemoteSync('A');
    expect(r.countSubmissionsRemote('A')).toBe(0);
    await tick();
    db.held[0]!();
    await settle();
    expect(r.countSubmissionsRemote('A')).toBe(5);
    expect(r.countTrashedSubmissionsRemote('A')).toBe(0);
  });
});

describe('a poll never undoes a trash still on the wire (audit B8)', () => {
  it('leaves a response in the trash when the poll read it before the write landed', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    // a0 is the newest response, so the poll's "at or after the newest seen"
    // window includes its row.
    expect(r.listSubmissionIndexRemote()[0]!.id).toBe('a0');

    db.hold = { match: (d) => d.includes('id=a0'), fail: false };
    r.trashSubmissionRemoteSync('a0');
    await tick();
    expect(db.held).toHaveLength(1);
    await r.refreshSubmissionsRemote();
    expect(db.calls.filter((c) => c.startsWith('select'))).not.toHaveLength(0);
    expect(r.getSubmissionRemote('a0')?.deletedAt).toBeDefined();
    expect(r.countTrashedSubmissionsRemote('A')).toBe(1);

    db.held[0]!();
    await settle();
    expect(r.getSubmissionRemote('a0')?.deletedAt).toBeDefined();
    expect(db.table.find((x) => x.id === 'a0')!.deleted_at).not.toBeNull();
  });

  it('a manual Refresh while a trash is out keeps the row trashed too', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    db.hold = { match: (d) => d.includes('id=a0'), fail: false };
    r.trashSubmissionRemoteSync('a0');
    await tick();
    await r.refreshSubmissionsRemote({ full: true });
    expect(r.getSubmissionRemote('a0')?.deletedAt).toBeDefined();
    expect(r.countTrashedSubmissionsRemote('A')).toBe(1);
    for (const release of db.held) release();
    await settle();
    expect(r.countTrashedSubmissionsRemote('A')).toBe(1);
  });
});
