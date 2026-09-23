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
  failNext: null as string | null,
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
      function run() {
        db.calls.push(`${st.op}${st.op === 'select' ? `(${st.cols})` : ''} [${st.filters.map((f) => f.desc).join(', ')}]`);
        if (db.failNext && st.op === db.failNext) {
          db.failNext = null;
          return { data: null, error: { message: 'boom', code: 'XX000' } };
        }
        const hit = db.table.filter((r) => st.filters.every((f) => f.test(r)));
        if (st.op === 'select') {
          const rows = hit
            .sort((a, z) => (a.received_at === z.received_at ? (a.id < z.id ? 1 : -1) : a.received_at < z.received_at ? 1 : -1))
            .slice(st.from, st.to + 1)
            .slice(0, st.limit)
            .map((r) =>
              st.cols === '*'
                ? r
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

const iso = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 23, 12, 0) - minutesAgo * 60_000).toISOString();
const row = (id: string, formId: string, minutesAgo: number, deleted = false): Row => ({
  id,
  form_id: formId,
  answers: { name: `person ${id}` },
  meta: { startedAt: '', completedAt: '', durationMs: 1000, questionsVisited: [], hiddenFields: {} },
  received_at: iso(minutesAgo),
  deleted_at: deleted ? iso(0) : null,
});

async function load() {
  vi.resetModules();
  return import('../examples/_admin/neon/submissionsRemote.js');
}

beforeEach(() => {
  db.calls = [];
  db.failNext = null;
  db.table = [];
  // 60 responses to form A, 5 to B (1 trashed).
  for (let i = 0; i < 60; i++) db.table.push(row(`a${String(i).padStart(3, '0')}`, 'A', i + 10));
  for (let i = 0; i < 5; i++) db.table.push(row(`b${i}`, 'B', 500 + i, i === 4));
});

describe('responses store: slim index + per-form answers (ADR-049)', () => {
  it('boot loads every response slim, but answers only for the 50 most recent', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    expect(db.calls.some((c) => c.startsWith('select(id,form_id,received_at,deleted_at)'))).toBe(true);
    expect(r.countSubmissionsRemote('A')).toBe(60);
    expect(r.countSubmissionsRemote('B')).toBe(4);
    expect(r.countTrashedSubmissionsRemote('B')).toBe(1);
    expect(r.lastSubmissionAtRemote('A')).toBe(iso(10));
    expect(r.listSubmissionIndexRemote()).toHaveLength(64);
    expect(r.listSubmissionsRemote()).toHaveLength(50);
    expect(r.isFormSubmissionsLoadedRemote('A')).toBe(false);
  });

  it('opening a form loads all of that form — and only that form — with answers', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    db.calls = [];
    await r.loadFormSubmissionsRemote('A');
    expect(db.calls).toEqual(['select(*) [form_id=A]']);
    expect(r.isFormSubmissionsLoadedRemote('A')).toBe(true);
    expect(r.listSubmissionsRemote('A')).toHaveLength(60);
    // A second open is free.
    await r.loadFormSubmissionsRemote('A');
    expect(db.calls).toHaveLength(1);
  });

  it('polling asks only for rows at or after the newest one seen', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    db.table.push(row('new1', 'B', 1));
    db.calls = [];
    await r.refreshSubmissionsRemote();
    expect(db.calls).toEqual(['select(*) [received_at>=]']);
    expect(r.getSubmissionRemote('new1')?.answers).toEqual({ name: 'person new1' });
    expect(r.countSubmissionsRemote('B')).toBe(5);
    expect(r.listSubmissionIndexRemote()[0]!.id).toBe('new1');
  });

  it('"Move all to trash" is one update, not one write per response', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    db.calls = [];
    r.trashSubmissionsRemoteSync('A');
    expect(r.countSubmissionsRemote('A')).toBe(0);
    expect(r.countTrashedSubmissionsRemote('A')).toBe(60);
    await vi.waitFor(() => expect(db.calls).toEqual(['update [deleted_at is null, form_id=A]']));
    expect(db.table.filter((x) => x.form_id === 'A' && x.deleted_at)).toHaveLength(60);
    // Answers were never rewritten.
    expect(db.table.find((x) => x.id === 'a000')!.answers).toEqual({ name: 'person a000' });
  });

  it('restore and empty-trash are single requests too', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    db.calls = [];
    r.restoreSubmissionsRemoteSync('B');
    await vi.waitFor(() => expect(db.calls).toHaveLength(1));
    expect(db.calls[0]).toBe('update [form_id=B, deleted_at not null]');
    expect(r.countTrashedSubmissionsRemote('B')).toBe(0);
    r.trashSubmissionRemoteSync('b0');
    r.emptyTrashRemoteSync('B');
    await vi.waitFor(() => expect(db.calls).toHaveLength(3));
    expect(db.calls[2]).toBe('delete [deleted_at not null, form_id=B]');
    expect(db.table.some((x) => x.id === 'b0')).toBe(false);
  });

  it('a failed write rolls the local change back and reports it', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    const errors: string[] = [];
    window.addEventListener('slate-persist-error', (e) =>
      errors.push((e as CustomEvent<{ message: string }>).detail.message),
    );
    db.failNext = 'update';
    r.trashSubmissionRemoteSync('a000');
    expect(r.countSubmissionsRemote('A')).toBe(59);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(r.countSubmissionsRemote('A')).toBe(60);
  });

  it('pages past the Data API row cap so the index is never truncated', async () => {
    for (let i = 0; i < 1500; i++) db.table.push(row(`c${String(i).padStart(4, '0')}`, 'C', 2000 + i));
    const r = await load();
    await r.hydrateSubmissionsRemote();
    expect(r.countSubmissionsRemote('C')).toBe(1500);
    expect(db.calls.filter((c) => c.startsWith('select(id,'))).toHaveLength(2);
  });

  it('a reload that reveals rows a loaded form lacks marks it for refetch', async () => {
    const r = await load();
    await r.hydrateSubmissionsRemote();
    await r.loadFormSubmissionsRemote('B');
    // 60 new rows for B arrive elsewhere — more than the recent-50 window covers.
    for (let i = 0; i < 60; i++) db.table.push(row(`bn${i}`, 'B', 0.01 * (i + 1)));
    await r.refreshSubmissionsRemote({ full: true });
    expect(r.isFormSubmissionsLoadedRemote('B')).toBe(false);
    await r.loadFormSubmissionsRemote('B');
    expect(r.listSubmissionsRemote('B')).toHaveLength(64);
  });
});
