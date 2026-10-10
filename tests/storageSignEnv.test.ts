/** @vitest-environment node */
/**
 * A typo in STORAGE_SIGN_MAX_BYTES must keep the 32 MiB cap, never remove it
 * (audit 2026-10: `Number('32MB')` is NaN, and `contentLength > NaN` is always
 * false, so owner uploads were bounded only by reserve_upload's 1 GiB check).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as S3 from '@aws-sdk/client-s3';
import { resetFnDb, type newFnDbState } from './_fnDb.js';

const MB = 1024 * 1024;
const FORM_ID = 'f_envcap01';
const OWNER = 'u_owner_env';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_c: unknown, cmd: { input: { Key: string } }) => {
    return `https://bucket.example/${cmd.input.Key}`;
  }),
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const real = await importOriginal<typeof S3>();
  return {
    ...real,
    S3Client: class {
      async send() {
        throw new Error('no S3 stub');
      }
    },
  };
});
vi.mock('../neon/functions/storage-sign/authJwt.js', () => ({
  verifyUserJwt: vi.fn(async (token: string) => (token === 'owner-jwt' ? { sub: OWNER } : null)),
}));

const ENV_KEYS = [
  'DATABASE_URL',
  'AWS_ENDPOINT_URL_S3',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'STORAGE_SIGN_MAX_BYTES',
] as const;
const savedEnv: Record<string, string | undefined> = {};
let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  process.env.AWS_ENDPOINT_URL_S3 = 'https://storage.example';
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  process.env.STORAGE_SIGN_MAX_BYTES = '32MB'; // the typo
  app = (await import('../neon/functions/storage-sign/index.js')).default;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  resetFnDb(db.state);
  db.state.forms.set(FORM_ID, {
    id: FORM_ID,
    status: 'published',
    deleted_at: null,
    owner_id: OWNER,
    fill_password_hash: null,
    published_schema: {
      questions: [{ id: 'big', type: 'file_upload', title: 'Big' }],
    },
  } as never);
});

const sign = (len: number) =>
  app.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.9',
      Authorization: 'Bearer owner-jwt',
    },
    body: JSON.stringify({
      op: 'upload',
      path: `draft/${FORM_ID}/${crypto.randomUUID()}/big.mov`,
      contentType: 'video/quicktime',
      contentLength: len,
    }),
  });

describe('STORAGE_SIGN_MAX_BYTES that is not an integer keeps the default cap', () => {
  it('an owner draft upload of 32 MiB + 1 is 413 and 32 MiB signs', async () => {
    expect((await sign(32 * MB + 1)).status).toBe(413);
    const ok = await sign(32 * MB);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { maxBytes: number }).maxBytes).toBe(32 * MB);
  });
});
