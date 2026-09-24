/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decidePublicUpload,
  fileUploadLimitBytes,
} from '../neon/functions/storage-sign/uploadPolicy.js';
import { fillUnlockToken } from '../neon/functions/storage-sign/fillLock.js';

const MB = 1024 * 1024;
const CAP = 32 * MB;

const fileQ = (extra: Record<string, unknown> = {}) => ({
  id: 'q_file',
  type: 'file_upload',
  title: 'Upload',
  ...extra,
});
const textQ = { id: 'q_name', type: 'short_text', title: 'Name' };

describe('fileUploadLimitBytes (ADR-050)', () => {
  it('no usable schema → null', () => {
    for (const schema of [undefined, null, '', 'schema', 42, true, [], {}]) {
      expect(fileUploadLimitBytes(schema, CAP)).toBeNull();
    }
  });

  it('questions that are not an array → null', () => {
    for (const questions of [undefined, null, 'file_upload', 7, { 0: fileQ() }, fileQ()]) {
      expect(fileUploadLimitBytes({ questions }, CAP)).toBeNull();
    }
  });

  it('only a question typed exactly file_upload counts', () => {
    expect(fileUploadLimitBytes({ questions: [] }, CAP)).toBeNull();
    const lookalikes = [
      textQ,
      { id: 'a', type: 'File_Upload' },
      { id: 'b', type: 'file' },
      { id: 'c', kind: 'file_upload' },
      { id: 'd', type: ['file_upload'] },
      null,
      'file_upload',
      42,
    ];
    expect(fileUploadLimitBytes({ questions: lookalikes }, CAP)).toBeNull();
    expect(fileUploadLimitBytes({ questions: [...lookalikes, fileQ()] }, CAP)).toBe(CAP);
  });

  it('unset maxSizeMb → the global cap', () => {
    expect(fileUploadLimitBytes({ questions: [textQ, fileQ()] }, CAP)).toBe(CAP);
  });

  it('maxSizeMb converts MB → bytes (binary MB, like the client)', () => {
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 5 })] }, CAP)).toBe(5 * MB);
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 2.5 })] }, CAP)).toBe(2.5 * MB);
  });

  it('never above the cap', () => {
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 500 })] }, CAP)).toBe(CAP);
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 1e308 })] }, CAP)).toBe(CAP);
    // A cap below the 1 MB floor still wins.
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 5 })] }, 0.5 * MB)).toBe(0.5 * MB);
  });

  it('sub-megabyte limits floor at 1 MB so a re-encoded photo is not refused', () => {
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 0.3 })] }, CAP)).toBe(MB);
    expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb: 1 })] }, CAP)).toBe(MB);
  });

  it('nonsense maxSizeMb (0, negative, NaN, Infinity, string) → the cap', () => {
    for (const maxSizeMb of [0, -1, NaN, Infinity, -Infinity, '5', null, {}]) {
      expect(fileUploadLimitBytes({ questions: [fileQ({ maxSizeMb })] }, CAP)).toBe(CAP);
    }
  });

  it('several file questions → the roomiest one', () => {
    const questions = [fileQ({ id: 'a', maxSizeMb: 2 }), fileQ({ id: 'b', maxSizeMb: 10 })];
    expect(fileUploadLimitBytes({ questions }, CAP)).toBe(10 * MB);
    // An unset limit on any file question opens the full cap.
    expect(fileUploadLimitBytes({ questions: [...questions, fileQ({ id: 'c' })] }, CAP)).toBe(CAP);
  });
});

describe('decidePublicUpload (ADR-050)', () => {
  const schema = { questions: [textQ, fileQ({ maxSizeMb: 5 })] };

  it('refuses a form with no file question, whatever the size', () => {
    expect(decidePublicUpload({ questions: [textQ] }, 1, CAP)).toEqual({
      ok: false,
      reason: 'no-file-question',
    });
    expect(decidePublicUpload(null, 1, CAP)).toEqual({ ok: false, reason: 'no-file-question' });
  });

  it('signs up to and including the limit', () => {
    expect(decidePublicUpload(schema, 1, CAP)).toEqual({ ok: true, maxBytes: 5 * MB });
    expect(decidePublicUpload(schema, 5 * MB, CAP)).toEqual({ ok: true, maxBytes: 5 * MB });
  });

  it('one byte over is too large', () => {
    expect(decidePublicUpload(schema, 5 * MB + 1, CAP)).toEqual({
      ok: false,
      reason: 'too-large',
      maxBytes: 5 * MB,
    });
    expect(decidePublicUpload({ questions: [fileQ()] }, CAP + 1, CAP)).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });

  it('fails closed on NaN length or a NaN cap', () => {
    expect(decidePublicUpload(schema, NaN, CAP).ok).toBe(false);
    expect(decidePublicUpload(schema, 1, NaN).ok).toBe(false);
  });
});

/* ---------- route wiring: storage-sign POST / with pg + S3 stubbed ---------- */

const db = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  sql: [] as string[],
}));

vi.mock('pg', () => ({
  Pool: class {
    async query(sql: string) {
      db.sql.push(sql);
      if (sql.includes('consume_submit_rate')) {
        return { rows: [{ allowed: true, hit_count: 1, retry_after_seconds: 0 }] };
      }
      return { rows: db.form ? [db.form] : [] };
    }
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://bucket.example/signed'),
}));
vi.mock('../neon/functions/storage-sign/authJwt.js', () => ({
  verifyUserJwt: vi.fn(async (token: string) =>
    token === 'owner-jwt' ? { sub: 'u_owner' } : null,
  ),
}));

describe('storage-sign upload gate (ADR-050)', () => {
  const FORM_ID = 'f_test1';
  const HASH = '$2a$08$abcdefghijklmnopqrstuuJ7gq0l1m9cQ4n3o8c5w2y1z0x9v8u7t';
  const ENV_KEYS = [
    'DATABASE_URL',
    'AWS_ENDPOINT_URL_S3',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };

  const row = (published_schema: unknown, extra: Record<string, unknown> = {}) => ({
    id: FORM_ID,
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner',
    fill_password_hash: null,
    published_schema,
    ...extra,
  });

  const sign = (
    scope: 'public' | 'draft',
    contentLength: number,
    extra: { unlockToken?: string; bearer?: string } = {},
  ) =>
    app.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.7',
        ...(extra.bearer ? { Authorization: `Bearer ${extra.bearer}` } : {}),
      },
      body: JSON.stringify({
        op: 'upload',
        path: `${scope}/${FORM_ID}/0f8fad5b-d9cb-469f-a165-70867728950e/receipt.pdf`,
        contentType: 'application/pdf',
        contentLength,
        unlockToken: extra.unlockToken,
      }),
    });

  const formQueries = () => db.sql.filter((s) => s.includes('from public.forms'));

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    process.env.AWS_ENDPOINT_URL_S3 = 'https://storage.example';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    app = (await import('../neon/functions/storage-sign/index.js')).default;
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    db.form = null;
    db.sql = [];
  });

  it('a Bearer on a public/ upload earns nothing — the file-question gate still applies', async () => {
    db.form = row({ questions: [textQ] });
    expect((await sign('public', 1024, { bearer: 'owner-jwt' })).status).toBe(404);
  });

  it('unpublished or trashed forms never sign public uploads, file question or not', async () => {
    db.form = row({ questions: [fileQ()] }, { status: 'draft' });
    expect((await sign('public', 1024)).status).toBe(404);
    db.form = row({ questions: [fileQ()] }, { deleted_at: '2026-01-01T00:00:00Z' });
    expect((await sign('public', 1024)).status).toBe(404);
  });

  it('signs a public upload on a form with a file question, in one form query', async () => {
    db.form = row({ questions: [textQ, fileQ({ maxSizeMb: 5 })] });
    const res = await sign('public', 2 * MB);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      url: 'https://bucket.example/signed',
      method: 'PUT',
      maxBytes: 5 * MB,
      contentType: 'application/pdf',
    });
    expect(formQueries()).toHaveLength(1);
    expect(formQueries()[0]).toContain('published_schema');
  });

  it('a published form without a file question is the same 404 as a missing form', async () => {
    db.form = row({ questions: [textQ] });
    const noFile = await sign('public', 1024);
    db.form = null;
    const missing = await sign('public', 1024);
    expect(noFile.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await noFile.text()).toBe(await missing.text());
  });

  it('null or malformed published_schema → 404', async () => {
    for (const schema of [null, { questions: 'nope' }, 'garbage']) {
      db.form = row(schema);
      expect((await sign('public', 1024)).status).toBe(404);
    }
  });

  it('over the question limit → 413, still under the global cap', async () => {
    db.form = row({ questions: [fileQ({ maxSizeMb: 5 })] });
    expect((await sign('public', 5 * MB + 1)).status).toBe(413);
  });

  it('over the global cap → 413 before any DB work', async () => {
    db.form = row({ questions: [fileQ()] });
    expect((await sign('public', CAP + 1)).status).toBe(413);
    expect(db.sql).toHaveLength(0);
  });

  it('locked form: 401 without a token even when it has no file question (no schema oracle)', async () => {
    db.form = row({ questions: [textQ] }, { fill_password_hash: HASH });
    expect((await sign('public', 1024)).status).toBe(401);
    // With the token, the policy applies as usual.
    const unlockToken = fillUnlockToken(FORM_ID, HASH);
    expect((await sign('public', 1024, { unlockToken })).status).toBe(404);
    db.form = row({ questions: [fileQ()] }, { fill_password_hash: HASH });
    expect((await sign('public', 1024, { unlockToken })).status).toBe(200);
  });

  it('draft/ uploads by the owner are unchanged: no schema read, global cap', async () => {
    db.form = row({ questions: [textQ] });
    const res = await sign('draft', 20 * MB, { bearer: 'owner-jwt' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { maxBytes: number }).maxBytes).toBe(CAP);
    expect(formQueries().every((s) => !s.includes('published_schema'))).toBe(true);
  });
});
