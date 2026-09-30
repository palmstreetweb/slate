/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as S3 from '@aws-sdk/client-s3';
import { rateCalls, rateKeys, resetFnDb, type newFnDbState } from './_fnDb.js';
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

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));
const s3 = vi.hoisted(() => ({
  send: null as null | ((cmd: { constructor: { name: string } }) => Promise<unknown>),
}));
const jwt = vi.hoisted(() => ({ throws: false }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://bucket.example/signed'),
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const real = await importOriginal<typeof S3>();
  return {
    ...real,
    S3Client: class {
      async send(cmd: { constructor: { name: string } }) {
        if (!s3.send) throw new Error('no S3 stub');
        return s3.send(cmd);
      }
    },
  };
});
vi.mock('../neon/functions/storage-sign/authJwt.js', () => ({
  verifyUserJwt: vi.fn(async (token: string) => {
    if (jwt.throws) throw new Error('JWKS unavailable');
    return token === 'owner-jwt'
      ? { sub: 'u_owner' }
      : token === 'other-jwt'
        ? { sub: 'u_other' }
        : null;
  }),
}));

describe('Wave C file questions (ADR-065)', () => {
  it('a voice note is a file question, capped by its recording length', () => {
    expect(fileUploadLimitBytes({ questions: [{ type: 'voice_note' }] }, CAP)).toBe(
      60 * 40_000 + 64 * 1024,
    );
    expect(
      fileUploadLimitBytes({ questions: [{ type: 'voice_note', maxSeconds: 300 }] }, CAP),
    ).toBe(300 * 40_000 + 64 * 1024);
    // Nonsense lengths fall back to the question's own bounds, never the global cap.
    expect(
      fileUploadLimitBytes({ questions: [{ type: 'voice_note', maxSeconds: 1e9 }] }, CAP),
    ).toBe(300 * 40_000 + 64 * 1024);
    expect(fileUploadLimitBytes({ questions: [{ type: 'voice_note', maxSeconds: 1 }] }, CAP)).toBe(
      MB,
    );
  });

  it('a photo checklist is a file question, 12 MB per photo', () => {
    expect(fileUploadLimitBytes({ questions: [{ type: 'photo_checklist', items: [] }] }, CAP)).toBe(
      12 * MB,
    );
  });

  it('the roomiest file question still wins, and the cap still bounds it', () => {
    expect(
      fileUploadLimitBytes(
        {
          questions: [
            { type: 'voice_note' },
            fileQ({ maxSizeMb: 20 }),
            { type: 'photo_checklist' },
          ],
        },
        CAP,
      ),
    ).toBe(20 * MB);
    expect(fileUploadLimitBytes({ questions: [{ type: 'photo_checklist' }] }, 5 * MB)).toBe(5 * MB);
  });

  it('other Wave C questions lend no storage', () => {
    for (const type of ['image_pin', 'location', 'availability']) {
      expect(fileUploadLimitBytes({ questions: [{ type }] }, CAP)).toBeNull();
    }
  });
});

describe('storage-sign upload gate (ADR-050, ADR-058)', () => {
  const FORM_ID = 'f_test1';
  const HASH = '$2a$08$abcdefghijklmnopqrstuuJ7gq0l1m9cQ4n3o8c5w2y1z0x9v8u7t';
  const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const ENV_KEYS = [
    'DATABASE_URL',
    'AWS_ENDPOINT_URL_S3',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
  let LIMITS: Record<string, number>;

  const setForm = (
    published_schema: unknown,
    extra: Record<string, unknown> = {},
    id = FORM_ID,
  ) => {
    db.state.forms.set(id, {
      id,
      status: 'published',
      deleted_at: null,
      owner_id: 'u_owner',
      fill_password_hash: null,
      published_schema,
      ...extra,
    } as never);
  };

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const sign = (
    scope: 'public' | 'draft',
    contentLength: unknown,
    extra: { unlockToken?: string; bearer?: string; formId?: string; ip?: string } = {},
  ) =>
    post(
      {
        op: 'upload',
        path: `${scope}/${extra.formId ?? FORM_ID}/${UUID}/receipt.pdf`,
        contentType: 'application/pdf',
        contentLength,
        unlockToken: extra.unlockToken,
      },
      {
        ...(extra.bearer ? { Authorization: `Bearer ${extra.bearer}` } : {}),
        ...(extra.ip ? { 'X-Forwarded-For': extra.ip } : {}),
      },
    );

  const read = (op: 'meta' | 'download' | 'content', bearer?: string) =>
    post(
      { op, path: `public/${FORM_ID}/${UUID}/receipt.pdf` },
      bearer ? { Authorization: `Bearer ${bearer}` } : {},
    );

  const formQueries = () =>
    db.state.log.filter(
      (q) => q.sql.includes('from public.forms') && !q.sql.includes('consume_submit_rates'),
    );

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.DATABASE_URL = 'postgres://test@localhost/test';
    process.env.AWS_ENDPOINT_URL_S3 = 'https://storage.example';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const mod = await import('../neon/functions/storage-sign/index.js');
    app = mod.default;
    LIMITS = mod.LIMITS;
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
    jwt.throws = false;
  });

  it('LIMITS match the ADR-058 table', () => {
    expect(LIMITS).toEqual({
      ipOwner: 8192,
      ip: 40960,
      draftUser: 8192,
      readUser: 3000,
      readIp: 15000,
      contentMaxBytes: 10 * 1024 * 1024,
    });
  });

  it('a Bearer on a public/ upload earns nothing — the file-question gate still applies', async () => {
    setForm({ questions: [textQ] });
    expect((await sign('public', 1024, { bearer: 'owner-jwt' })).status).toBe(404);
  });

  it('unpublished or trashed forms never sign public uploads, and charge nothing', async () => {
    setForm({ questions: [fileQ()] }, { status: 'draft' });
    expect((await sign('public', 1024)).status).toBe(404);
    setForm({ questions: [fileQ()] }, { deleted_at: '2026-01-01T00:00:00Z' });
    expect((await sign('public', 1024)).status).toBe(404);
    expect(rateCalls(db.state)).toHaveLength(0);
  });

  it('the gate query has no published_schema; the rate statement returns it', async () => {
    setForm({ questions: [textQ, fileQ({ maxSizeMb: 5 })] });
    const res = await sign('public', 2 * MB);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      url: 'https://bucket.example/signed',
      method: 'PUT',
      maxBytes: 5 * MB,
      contentType: 'application/pdf',
    });
    expect(formQueries()).toHaveLength(1);
    expect(formQueries()[0]!.sql).not.toMatch(/published_schema\s*,/);
    expect(formQueries()[0]!.sql).toContain('published_schema is not null');
    expect(rateCalls(db.state)).toHaveLength(1);
    expect(rateCalls(db.state)[0]!.sql).toContain('f.published_schema');
    expect(db.state.log).toHaveLength(2);
  });

  it('a published form without a file question is the same 404 as a missing form', async () => {
    setForm({ questions: [textQ] });
    const noFile = await sign('public', 1024);
    resetFnDb(db.state);
    const missing = await sign('public', 1024);
    expect(noFile.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await noFile.text()).toBe(await missing.text());
  });

  it('null or malformed published_schema → 404', async () => {
    for (const schema of [null, { questions: 'nope' }, 'garbage']) {
      setForm(schema);
      expect((await sign('public', 1024)).status).toBe(404);
    }
  });

  it('published_schema null: 404 without any rate SQL', async () => {
    setForm(null);
    expect((await sign('public', 1024)).status).toBe(404);
    expect(rateCalls(db.state)).toHaveLength(0);
  });

  it('over the question limit → 413, still under the global cap', async () => {
    setForm({ questions: [fileQ({ maxSizeMb: 5 })] });
    expect((await sign('public', 5 * MB + 1)).status).toBe(413);
  });

  it('over the global cap → 413 before any DB work', async () => {
    setForm({ questions: [fileQ()] });
    expect((await sign('public', CAP + 1)).status).toBe(413);
    expect(db.state.log).toHaveLength(0);
  });

  it('locked form: 401 without a token even when it has no file question (no schema oracle)', async () => {
    setForm({ questions: [textQ] }, { fill_password_hash: HASH });
    expect((await sign('public', 1024)).status).toBe(401);
    expect(rateCalls(db.state)).toHaveLength(0);
    // With the token, the policy applies as usual.
    const unlockToken = fillUnlockToken(FORM_ID, HASH);
    expect((await sign('public', 1024, { unlockToken })).status).toBe(404);
    setForm({ questions: [fileQ()] }, { fill_password_hash: HASH });
    expect((await sign('public', 1024, { unlockToken })).status).toBe(200);
  });

  it('draft/ uploads by the owner are unchanged: no schema read, global cap', async () => {
    setForm({ questions: [textQ] });
    const res = await sign('draft', 20 * MB, { bearer: 'owner-jwt' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { maxBytes: number }).maxBytes).toBe(CAP);
    expect(formQueries().every((q) => !/published_schema\s*,/.test(q.sql))).toBe(true);
    expect(rateCalls(db.state).every((q) => q.params.length === 4)).toBe(true);
  });

  /* ---------- ADR-058: shapes before any DB call ---------- */

  it('a 9 KiB body is 413 with zero queries, with Content-Length or chunked', async () => {
    const big = JSON.stringify({ op: 'upload', path: 'x', pad: 'a'.repeat(9 * 1024) });
    const withLength = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(big.length) },
      body: big,
    });
    expect(withLength.status).toBe(413);
    const bytes = new TextEncoder().encode(big);
    const chunked = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.slice(i, i + 1000));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(chunked.status).toBe(413);
    expect(db.state.log).toHaveLength(0);
  });

  it('bad fields are 400 with zero queries', async () => {
    setForm({ questions: [fileQ()] });
    const path = `public/${FORM_ID}/${UUID}/receipt.pdf`;
    for (const body of [
      null,
      [],
      'x',
      { op: 'delete', path },
      { op: 'upload', path, contentLength: 1.5 },
      { op: 'upload', path, contentLength: '12' },
      { op: 'upload', path, contentLength: 1e20 },
      { op: 'upload', path, contentLength: 10, contentType: 'a'.repeat(300) },
      { op: 'upload', path, contentLength: 10, unlockToken: 'abc' },
      { op: 'upload', path: 42, contentLength: 10 },
    ]) {
      const res = await post(body === 'x' ? 'x' : body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await sign('public', 32 * MB + 1)).status).toBe(413);
    expect(db.state.log).toHaveLength(0);
  });

  it('junk formId: 404 after one form query and no rate SQL', async () => {
    expect((await sign('public', 1024, { formId: 'f_nothere00' })).status).toBe(404);
    expect(db.state.log).toHaveLength(1);
    expect(rateCalls(db.state)).toHaveLength(0);
  });

  it('charges by size to IP + owner and IP', async () => {
    setForm({ questions: [fileQ()] });
    await sign('public', 2 * MB);
    await sign('public', 12_000_000);
    await sign('public', 32 * MB);
    const calls = rateCalls(db.state);
    expect(calls[0]!.params[0]).toEqual(['up:ipowner:203.0.113.7:u_owner', 'up:ip:203.0.113.7']);
    expect(calls.map((q) => (q.params[3] as number[])[0])).toEqual([8, 46, 128]);
    expect(calls[0]!.params[2]).toEqual([8192, 40960]);
  });

  it('4,096 photo signs from one IP to one owner pass, the next is 429; another owner still signs', async () => {
    setForm({ questions: [fileQ()] });
    setForm({ questions: [fileQ()] }, { owner_id: 'u_second' }, 'f_second');
    for (let i = 0; i < 4096; i++) {
      const res = await sign('public', 450_000);
      if (res.status !== 200) throw new Error(`sign ${i} → ${res.status}`);
    }
    const denied = await sign('public', 450_000);
    expect(denied.status).toBe(429);
    const body = (await denied.json()) as { error: string; retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.error).toMatch(/^Too many uploads .*mobile data/);
    expect(denied.headers.get('Retry-After')).toBe(String(body.retryAfterSeconds));
    expect(denied.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect((await sign('public', 450_000, { formId: 'f_second' })).status).toBe(200);
  });

  it('OPTIONS carries Access-Control-Max-Age: 7200', async () => {
    const res = await app.request('/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://slate.test', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('Access-Control-Max-Age')).toBe('7200');
  });

  /* ---------- ADR-058: owner reads and draft uploads ---------- */

  it('meta, download and content with no Bearer: 401 with zero queries', async () => {
    setForm({ questions: [fileQ()] });
    for (const op of ['meta', 'download', 'content'] as const) {
      expect((await read(op)).status).toBe(401);
    }
    expect(db.state.log).toHaveLength(0);
  });

  it('forged Bearer: 401 with zero queries; a verifier that throws: 503 with zero queries', async () => {
    setForm({ questions: [fileQ()] });
    expect((await read('meta', 'forged')).status).toBe(401);
    jwt.throws = true;
    expect((await read('meta', 'owner-jwt')).status).toBe(503);
    expect(db.state.log).toHaveLength(0);
  });

  it('valid Bearer: one charge to the account and the IP before the owner lookup', async () => {
    setForm({ questions: [fileQ()] });
    s3.send = async () => ({ ContentLength: 10, ContentType: 'application/pdf' });
    expect((await read('meta', 'owner-jwt')).status).toBe(200);
    expect(db.state.log[0]!.sql).toContain('consume_submit_rates');
    expect(db.state.log[0]!.params[0]).toEqual(['read:u:u_owner', 'read:ip:203.0.113.7']);
    expect(db.state.log[1]!.sql).toContain('from public.forms');
    const notYours = await read('meta', 'other-jwt');
    resetFnDb(db.state);
    const missing = await read('meta', 'owner-jwt');
    expect(notYours.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await notYours.text()).toBe(await missing.text());
  });

  it('the 3,001st read in 10 min is 429 with retryAfterSeconds', async () => {
    setForm({ questions: [fileQ()] });
    s3.send = async () => ({ ContentLength: 10, ContentType: 'application/pdf' });
    for (let i = 0; i < 3000; i++) {
      const res = await read('meta', 'owner-jwt');
      if (res.status !== 200) throw new Error(`read ${i} → ${res.status}`);
    }
    const denied = await read('meta', 'owner-jwt');
    expect(denied.status).toBe(429);
    expect(
      ((await denied.json()) as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBeGreaterThan(0);
  });

  it('a 2 MiB draft upload charges the account and the IP by size; no legacy keys', async () => {
    setForm({ questions: [textQ] });
    expect((await sign('draft', 2 * MB, { bearer: 'owner-jwt' })).status).toBe(200);
    expect(rateCalls(db.state)[0]!.params[0]).toEqual(['up:draft:u_owner', 'up:ip:203.0.113.7']);
    expect((rateCalls(db.state)[0]!.params[3] as number[])[0]).toBe(8);
    expect(rateKeys(db.state).some((k) => /^(read:|sign:read:|sign:auth:)/.test(k))).toBe(false);
  });

  it('meta: NotFound → 404; SlowDown or 500 → 503', async () => {
    setForm({ questions: [fileQ()] });
    const fail = (name: string, status: number) => async () => {
      throw Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
    };
    s3.send = fail('NotFound', 404);
    expect((await read('meta', 'owner-jwt')).status).toBe(404);
    s3.send = fail('SlowDown', 503);
    expect((await read('meta', 'owner-jwt')).status).toBe(503);
    s3.send = fail('InternalError', 500);
    expect((await read('meta', 'owner-jwt')).status).toBe(503);
  });

  it('content: NoSuchKey → 404; over 10 MiB or no length → 413 and the body is destroyed; 1 MiB → 200', async () => {
    setForm({ questions: [fileQ()] });
    s3.send = async () => {
      throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    };
    expect((await read('content', 'owner-jwt')).status).toBe(404);

    const destroy = vi.fn();
    const bodyOf = (n: number) => ({
      transformToByteArray: async () => new Uint8Array(n),
      destroy,
    });
    s3.send = async () => ({
      Body: bodyOf(0),
      ContentLength: 11 * MB,
      ContentType: 'application/pdf',
    });
    const big = await read('content', 'owner-jwt');
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'too_large_for_preview' });
    expect(destroy).toHaveBeenCalledTimes(1);

    s3.send = async () => ({ Body: bodyOf(0), ContentType: 'application/pdf' });
    expect((await read('content', 'owner-jwt')).status).toBe(413);
    expect(destroy).toHaveBeenCalledTimes(2);

    s3.send = async () => ({ Body: bodyOf(MB), ContentLength: MB, ContentType: 'application/pdf' });
    const ok = await read('content', 'owner-jwt');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('application/pdf');
    expect(ok.headers.get('Content-Disposition')).toBe('attachment; filename="receipt.pdf"');
    expect(ok.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await ok.arrayBuffer()).byteLength).toBe(MB);

    s3.send = async () => {
      throw Object.assign(new Error('boom'), { name: 'InternalError' });
    };
    expect((await read('content', 'owner-jwt')).status).toBe(503);
  });

  it('voice notes sign audio/webm and audio/mp4 as themselves, within the recording cap (ADR-065)', async () => {
    setForm({ questions: [textQ, { id: 'v', type: 'voice_note', maxSeconds: 60 }] });
    const voice = (contentType: string, contentLength: number) =>
      post({
        op: 'upload',
        path: `public/${FORM_ID}/${UUID}/voice-note.webm`,
        contentType,
        contentLength,
      });
    const webm = await voice('audio/webm;codecs=opus', 900_000);
    expect(webm.status).toBe(200);
    expect(await webm.json()).toMatchObject({
      contentType: 'audio/webm',
      maxBytes: 60 * 40_000 + 64 * 1024,
    });
    const mp4 = await voice('audio/mp4', 900_000);
    expect(await mp4.json()).toMatchObject({ contentType: 'audio/mp4' });
    expect((await voice('audio/webm', 3 * MB)).status).toBe(413);
  });

  it('a photo checklist opens public uploads up to 12 MB a photo (ADR-065)', async () => {
    setForm({
      questions: [
        { id: 'c', type: 'photo_checklist', items: [{ label: 'Front', value: 'front' }] },
      ],
    });
    expect((await sign('public', 2 * MB)).status).toBe(200);
    expect((await sign('public', 13 * MB)).status).toBe(413);
  });
});
