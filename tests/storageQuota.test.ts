/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as S3 from '@aws-sdk/client-s3';
import { addUpload, ownerUsage, resetFnDb, type newFnDbState } from './_fnDb.js';
import {
  decideQuestionUpload,
  questionLimitBytes,
} from '../neon/functions/storage-sign/uploadPolicy.js';
import {
  isQuestionId,
  networkKey,
  mintUploadKey,
  safeUploadName,
} from '../neon/functions/storage-sign/uploadKey.js';
import { runSweep } from '../neon/functions/storage-sign/sweep.js';

// ADR-067: storagesign picks every key, records it against the form owner's
// quota in one statement, and signs the PUT for exactly the declared bytes.

const MB = 1024 * 1024;
const GB = 1024 * MB;
const CAP = 32 * MB;
const FORM_ID = 'f_quota01';
const OWNER = 'u_owner';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));
const s3 = vi.hoisted(() => ({
  send: null as
    | null
    | ((cmd: { constructor: { name: string }; input?: unknown }) => Promise<unknown>),
  calls: [] as Array<{ name: string; key: string }>,
}));
const presigner = vi.hoisted(() => ({ fail: false }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(
    async (_c: unknown, cmd: { input: { Key: string; ContentLength: number } }) => {
      if (presigner.fail) throw new Error('presign down');
      return `https://bucket.example/${cmd.input.Key}?len=${cmd.input.ContentLength}`;
    },
  ),
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const real = await importOriginal<typeof S3>();
  return {
    ...real,
    S3Client: class {
      async send(cmd: { constructor: { name: string }; input: { Key: string } }) {
        s3.calls.push({ name: cmd.constructor.name, key: cmd.input.Key });
        if (!s3.send) throw new Error('no S3 stub');
        return s3.send(cmd);
      }
    },
  };
});
vi.mock('../neon/functions/storage-sign/authJwt.js', () => ({
  verifyUserJwt: vi.fn(async (token: string) =>
    token === 'owner-jwt' ? { sub: OWNER } : token === 'other-jwt' ? { sub: 'u_other' } : null,
  ),
}));

const schema = {
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    { id: 'docs', type: 'file_upload', title: 'Docs', maxSizeMb: 5 },
    { id: 'big', type: 'file_upload', title: 'Big' },
    { id: 'story', type: 'voice_note', title: 'Tell us', maxSeconds: 30 },
    { id: 'shots', type: 'photo_checklist', title: 'Photos', items: [{ label: 'A', value: 'a' }] },
  ],
};

describe('per-question limits and keys (pure)', () => {
  it('a named question sets its own limit; a question that takes no files lends nothing', () => {
    expect(decideQuestionUpload(schema, 'docs', 5 * MB, CAP)).toEqual({
      ok: true,
      maxBytes: 5 * MB,
    });
    expect(decideQuestionUpload(schema, 'docs', 5 * MB + 1, CAP)).toMatchObject({
      reason: 'too-large',
    });
    // The roomiest question (big, 32 MB) no longer lends its room to docs.
    expect(decideQuestionUpload(schema, 'story', 2 * MB, CAP)).toMatchObject({
      reason: 'too-large',
    });
    expect(decideQuestionUpload(schema, 'story', 30 * 40_000, CAP)).toMatchObject({ ok: true });
    expect(decideQuestionUpload(schema, 'shots', 12 * MB, CAP)).toMatchObject({ ok: true });
    for (const id of ['name', 'nope', '__proto__']) {
      expect(decideQuestionUpload(schema, id, 10, CAP)).toEqual({
        ok: false,
        reason: 'no-file-question',
      });
    }
    expect(decideQuestionUpload(null, 'docs', 10, CAP).ok).toBe(false);
    expect(decideQuestionUpload(schema, 'docs', Number.NaN, CAP).ok).toBe(false);
    expect(questionLimitBytes({ type: 'file_upload', maxSizeMb: 0.1 }, CAP)).toBe(MB);
  });

  it('keys: a fresh uuid under the scope and form, the name cleaned', () => {
    const a = mintUploadKey('public', FORM_ID, 'My receipt (1).pdf');
    const b = mintUploadKey('public', FORM_ID, 'My receipt (1).pdf');
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^public/${FORM_ID}/${UUID_RE.source}/My receipt \\(1\\)\\.pdf$`));
    expect(safeUploadName('évil"<script>.jpg')).toBe('_vil__script_.jpg');
    expect(safeUploadName('..')).toBe('file');
    expect(safeUploadName('x'.repeat(200))).toHaveLength(120);
  });

  it('question ids: 1–128 characters, no slash or control characters', () => {
    for (const ok of ['docs', 'q_1', 'Photo-2', 'x'.repeat(128), 'with space']) {
      expect(isQuestionId(ok), ok).toBe(true);
    }
    for (const bad of ['', 'a/b', 'x'.repeat(129), 'a\nb', 42, null, 'toString', '__proto__']) {
      expect(isQuestionId(bad), String(bad)).toBe(false);
    }
  });
});

describe('storagesign with quotas (ADR-067)', () => {
  const ENV_KEYS = [
    'DATABASE_URL',
    'AWS_ENDPOINT_URL_S3',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
  let COPY: Record<string, unknown>;

  const setForm = (extra: Record<string, unknown> = {}, id = FORM_ID) =>
    db.state.forms.set(id, {
      id,
      status: 'published',
      deleted_at: null,
      owner_id: OWNER,
      fill_password_hash: null,
      published_schema: schema,
      ...extra,
    } as never);

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.9',
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const sign = (
    len: number,
    extra: {
      questionId?: string | null;
      scope?: 'public' | 'draft';
      bearer?: string;
      path?: string;
      /** X-Forwarded-For; '' sends none (the no-IP share). */
      ip?: string;
    } = {},
  ) =>
    post(
      {
        op: 'upload',
        path:
          extra.path ?? `${extra.scope ?? 'public'}/${FORM_ID}/${crypto.randomUUID()}/photo.jpg`,
        contentType: 'image/jpeg',
        contentLength: len,
        ...(extra.questionId === null ? {} : { questionId: extra.questionId ?? 'big' }),
      },
      {
        ...(extra.bearer ? { Authorization: `Bearer ${extra.bearer}` } : {}),
        ...(extra.ip !== undefined ? { 'X-Forwarded-For': extra.ip } : {}),
      },
    );

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    process.env.AWS_ENDPOINT_URL_S3 = 'https://storage.example';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const mod = await import('../neon/functions/storage-sign/index.js');
    app = mod.default;
    COPY = mod.STORAGE_COPY;
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    resetFnDb(db.state);
    s3.send = null;
    s3.calls.length = 0;
    presigner.fail = false;
  });

  it('the server picks the key: a new uuid, recorded with the owner, form, question and bytes', async () => {
    setForm();
    const asked = `public/${FORM_ID}/00000000-0000-4000-8000-000000000000/photo.jpg`;
    const res = await sign(450_000, { questionId: 'big', path: asked });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; url: string; maxBytes: number };
    expect(body.key).not.toBe(asked);
    expect(body.key).toMatch(new RegExp(`^public/${FORM_ID}/${UUID_RE.source}/photo\\.jpg$`));
    // The PUT is signed for that key and exactly those bytes.
    expect(body.url).toBe(`https://bucket.example/${body.key}?len=450000`);
    expect(body.maxBytes).toBe(CAP);
    const row = db.state.uploads.get(body.key)!;
    expect(row).toMatchObject({
      owner_id: OWNER,
      form_id: FORM_ID,
      question_id: 'big',
      bytes: 450_000,
      content_type: 'image/jpeg',
      state: 'pending',
      legacy: false,
    });
    expect(db.state.uploads.has(asked)).toBe(false);
  });

  it('the named question’s own limit applies (413), and a non-file or unknown question is a 404', async () => {
    setForm();
    expect((await sign(5 * MB + 1, { questionId: 'docs' })).status).toBe(413);
    expect((await sign(5 * MB, { questionId: 'docs' })).status).toBe(200);
    expect((await sign(1000, { questionId: 'name' })).status).toBe(404);
    expect((await sign(1000, { questionId: 'gone' })).status).toBe(404);
    expect(db.state.uploads.size).toBe(1);
  });

  it('a bad questionId is a 400 before any query', async () => {
    setForm();
    for (const questionId of [42, '', 'a/b', 'x'.repeat(129)]) {
      const res = await post({
        op: 'upload',
        path: `public/${FORM_ID}/${crypto.randomUUID()}/p.jpg`,
        contentLength: 10,
        questionId,
      });
      expect(res.status, String(questionId)).toBe(400);
    }
    expect(db.state.log).toHaveLength(0);
  });

  it('a full quota is 507 with the respondent copy — nothing about the owner’s usage', async () => {
    setForm();
    addUpload(db.state, {
      key: `public/${FORM_ID}/${crypto.randomUUID()}/old.jpg`,
      bytes: GB - 1000,
      state: 'claimed',
      submission_id: 's_1',
    });
    expect((await sign(1000)).status).toBe(200);
    const res = await sign(1);
    expect(res.status).toBe(507);
    const text = await res.text();
    expect(text).toBe(COPY.respondent);
    expect(text).not.toMatch(/\d/);
    expect(ownerUsage(db.state, OWNER).bytes).toBe(GB);
  });

  it('an unclaimed upload counts for 2 h after signing, then stops; claimed ones always count', async () => {
    setForm();
    db.state.now = Date.parse('2026-10-01T12:00:00Z');
    const stale = addUpload(db.state, {
      key: `public/${FORM_ID}/${crypto.randomUUID()}/stale.jpg`,
      bytes: GB,
      created_at: db.state.now - 2 * 3600 * 1000 - 60_000,
    });
    expect((await sign(MB)).status).toBe(200);
    stale.created_at = db.state.now - 2 * 3600 * 1000 + 60_000;
    expect((await sign(MB)).status).toBe(507);
    stale.state = 'claimed';
    stale.submission_id = 's_1';
    stale.created_at = db.state.now - 30 * 24 * 3600 * 1000;
    expect((await sign(MB)).status).toBe(507);
  });

  describe('a network’s share of the owner’s unclaimed bytes', () => {
    const HALF = GB / 2;

    it('the row keeps a hash of the network, never the address, and a claim would clear it', async () => {
      setForm();
      const res = await sign(MB, { ip: '203.0.113.50' });
      const key = ((await res.json()) as { key: string }).key;
      const row = db.state.uploads.get(key)!;
      expect(row.net_key).toBe(networkKey('203.0.113.50'));
      expect(row.net_key).toMatch(/^n[0-9a-f]{40}$/);
      expect(JSON.stringify(row)).not.toContain('203.0.113.50');
      expect(networkKey('203.0.113.50')).not.toBe(networkKey('203.0.113.51'));
    });

    it('half the quota per network: full refuses that network only, with the same copy', async () => {
      setForm();
      addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/venue.jpg`,
        bytes: HALF - MB,
        net_key: networkKey('198.51.100.20'),
      });
      expect((await sign(MB, { ip: '198.51.100.20' })).status).toBe(200);
      const full = await sign(1, { ip: '198.51.100.20' });
      expect(full.status).toBe(507);
      expect(await full.text()).toBe(COPY.respondent);
      // Another network, and the owner's own studio, still sign.
      expect((await sign(MB, { ip: '198.51.100.21' })).status).toBe(200);
      expect(
        (await sign(MB, { scope: 'draft', bearer: 'owner-jwt', ip: '198.51.100.20' })).status,
      ).toBe(200);
      // A share frees up as its uploads are claimed, or age out of the 2 h window.
      for (const u of db.state.uploads.values()) {
        if (u.net_key === networkKey('198.51.100.20')) u.created_at -= 2 * 3600 * 1000 + 1000;
      }
      expect((await sign(MB, { ip: '198.51.100.20' })).status).toBe(200);
    });

    it('requests with no client IP share 32 MiB between them', async () => {
      setForm();
      const noLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (let i = 0; i < 32; i++) expect((await sign(MB, { ip: '' })).status).toBe(200);
      expect((await sign(MB, { ip: '' })).status).toBe(507);
      expect([...db.state.uploads.values()].every((u) => u.net_key === 'noip')).toBe(true);
      noLog.mockRestore();
      expect((await sign(MB, { ip: '198.51.100.30' })).status).toBe(200);
    });

    it('an override raises the owner’s quota, and with it every network’s share', async () => {
      setForm();
      addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/big.bin`,
        bytes: GB,
        state: 'claimed',
        submission_id: 's_1',
      });
      expect((await sign(MB, { ip: '198.51.100.40' })).status).toBe(507);
      db.state.storage.overrides.set(OWNER, 5 * GB);
      const ok = await sign(MB, { ip: '198.51.100.40' });
      expect(ok.status).toBe(200);
      addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/fair.bin`,
        bytes: 2 * GB,
        net_key: networkKey('198.51.100.40'),
      });
      // 2 GiB + 1 MiB unclaimed from one network fits the 2.5 GiB share of a 5 GiB override.
      expect((await sign(MB, { ip: '198.51.100.40' })).status).toBe(200);
      db.state.storage.overrides.delete(OWNER);
      expect((await sign(MB, { ip: '198.51.100.41' })).status).toBe(507);
    });
  });

  it('the owner’s own studio upload says how full the account is', async () => {
    setForm();
    addUpload(db.state, {
      key: `draft/${FORM_ID}/${crypto.randomUUID()}/big.mov`,
      bytes: GB - 10,
      state: 'claimed',
      submission_id: 's_1',
    });
    const res = await sign(MB, { scope: 'draft', bearer: 'owner-jwt' });
    expect(res.status).toBe(507);
    expect(await res.text()).toBe(
      'Your Slate file storage is full (1 GB of 1 GB). Permanently delete responses you no longer need to make room.',
    );
  });

  it('too many pending uploads, or the bucket ceiling: 507, and the ceiling logs loudly', async () => {
    setForm();
    db.state.storage.pendingMax = 2;
    expect((await sign(10)).status).toBe(200);
    expect((await sign(10)).status).toBe(200);
    const pending = await sign(10);
    expect(pending.status).toBe(507);
    expect(await pending.text()).toBe(COPY.respondent);

    resetFnDb(db.state);
    setForm();
    db.state.storage.globalMax = 100;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const global = await sign(101);
    expect(global.status).toBe(507);
    expect(err.mock.calls.some((c) => String(c[0]).includes('GLOBAL STORAGE CEILING'))).toBe(true);
    const owner = await sign(101, { scope: 'draft', bearer: 'owner-jwt' });
    expect(await owner.text()).toBe(COPY.unavailable);
    err.mockRestore();
  });

  it('a form with no owner takes no files (fail closed)', async () => {
    setForm({ owner_id: null });
    expect((await sign(10)).status).toBe(507);
    expect(db.state.uploads.size).toBe(0);
  });

  it('the reserve statement failing is a 503: nothing is signed', async () => {
    setForm();
    db.state.fail.reserve = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await sign(10);
    expect(res.status).toBe(503);
    vi.mocked(console.error).mockRestore();
  });

  it('a presign that fails gives the bytes back at once', async () => {
    setForm();
    presigner.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await sign(MB)).status).toBe(500);
    expect(db.state.uploads.size).toBe(0);
    vi.mocked(console.error).mockRestore();
  });

  describe('an old page (no questionId) during and after the grace', () => {
    it('during: its own path is signed and recorded, with no question; a taken path is 409', async () => {
      setForm();
      const path = `public/${FORM_ID}/${crypto.randomUUID()}/old-page.jpg`;
      const res = await sign(MB, { questionId: null, path });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { key: string }).key).toBe(path);
      expect(db.state.uploads.get(path)).toMatchObject({ question_id: null, legacy: true });
      const again = await sign(MB, { questionId: null, path });
      expect(again.status).toBe(409);
      expect(await again.text()).toBe(COPY.retry);
      // The roomiest question's limit, as before.
      expect((await sign(CAP, { questionId: null })).status).toBe(200);
    });

    it('after: 400 with copy that tells them to reload', async () => {
      setForm();
      db.state.storage.legacyOpen = false;
      const res = await sign(MB, { questionId: null });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(COPY.stale);
      expect(db.state.uploads.size).toBe(0);
      // A new page is unaffected.
      expect((await sign(MB)).status).toBe(200);
    });
  });

  describe('the sweep', () => {
    it('runs once the gate opens: doomed and expired objects deleted, unused signs dropped, the rest checked', async () => {
      setForm();
      const now = Date.parse('2026-10-01T12:00:00Z');
      db.state.now = now;
      const doomed = addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/deleted-response.jpg`,
        state: 'doomed',
        submission_id: 's_gone',
      }).key;
      const expired = addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/abandoned.jpg`,
        created_at: now - 25 * 3600 * 1000,
      }).key;
      const neverPut = addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/never.jpg`,
        created_at: now - 31 * 60 * 1000,
      }).key;
      const landed = addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/landed.jpg`,
        created_at: now - 31 * 60 * 1000,
        bytes: 5000,
      }).key;
      const fresh = addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/fresh.jpg`,
      }).key;
      s3.send = async (cmd) => {
        const key = (cmd.input as { Key: string }).Key;
        if (cmd.constructor.name === 'DeleteObjectCommand') return {};
        if (key === neverPut) {
          throw Object.assign(new Error('NotFound'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          });
        }
        return { ContentLength: 4096 };
      };
      db.state.storage.sweepDue = true;
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      expect((await sign(10)).status).toBe(200);
      info.mockRestore();
      expect(
        s3.calls
          .filter((c) => c.name === 'DeleteObjectCommand')
          .map((c) => c.key)
          .sort(),
      ).toEqual([doomed, expired].sort());
      expect(db.state.uploads.has(doomed)).toBe(false);
      expect(db.state.uploads.has(expired)).toBe(false);
      expect(db.state.uploads.has(neverPut)).toBe(false);
      expect(db.state.uploads.get(landed)).toMatchObject({ verified: true, bytes: 4096 });
      expect(db.state.uploads.get(fresh)?.verified).toBe(false);
      expect(s3.calls.some((c) => c.key === fresh)).toBe(false);
    });

    it('a sweep that fails never changes the sign’s answer', async () => {
      setForm();
      addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/x.jpg`,
        state: 'doomed',
        submission_id: 's_x',
      });
      s3.send = async () => {
        throw new Error('S3 down');
      };
      db.state.storage.sweepDue = true;
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      expect((await sign(10)).status).toBe(200);
      info.mockRestore();
      // Still there, lease kept: a later sweep retries.
      expect(db.state.uploads.size).toBe(2);
    });

    it('runSweep stops starting calls when its time budget is spent', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({
        obj_key: `k${i}`,
        obj_action: 'delete',
      }));
      const finished: unknown[][] = [];
      const pool = {
        query: async (sql: string, params: unknown[]) => {
          if (sql.includes('storage_sweep_begin')) return { rows };
          finished.push(params);
          return { rows: [{}] };
        },
      };
      const r = await runSweep(
        pool as never,
        {
          remove: () => new Promise((ok) => setTimeout(ok, 30)),
          head: async () => 1,
        },
        { batch: 20, concurrency: 2, budgetMs: 45 },
      );
      expect(r.deleted).toBeGreaterThan(0);
      expect(r.left).toBeGreaterThan(0);
      expect(r.deleted + r.left).toBe(20);
      expect((finished[0]![0] as string[]).length).toBe(r.deleted);
      // A full global batch asks for the gate again soon.
      expect(finished[0]![2]).toBe(true);
    });

    it('purge: the owner’s own doomed objects only, behind a verified Bearer', async () => {
      setForm();
      const mine = addUpload(db.state, {
        key: `public/${FORM_ID}/${crypto.randomUUID()}/mine.jpg`,
        state: 'doomed',
        submission_id: 's_1',
      }).key;
      const theirs = addUpload(db.state, {
        key: `public/f_theirs01/${crypto.randomUUID()}/theirs.jpg`,
        owner_id: 'u_other',
        form_id: 'f_theirs01',
        state: 'doomed',
        submission_id: 's_2',
      }).key;
      s3.send = async () => ({});
      expect((await post({ op: 'purge' })).status).toBe(401);
      expect((await post({ op: 'purge' }, { Authorization: 'Bearer forged' })).status).toBe(401);
      expect(db.state.log).toHaveLength(0);
      const res = await post({ op: 'purge' }, { Authorization: 'Bearer owner-jwt' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: 1, more: false });
      expect(db.state.uploads.has(mine)).toBe(false);
      expect(db.state.uploads.has(theirs)).toBe(true);
      expect(s3.calls.map((c) => c.key)).toEqual([mine]);
    });
  });
});
