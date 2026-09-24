// @vitest-environment node
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const NEON_URL = 'https://ep-misty-snow-123.c-4.us-east-2.aws.neon.tech/neondb';
const AUTH_BASE = 'https://ep-misty-snow-123.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth';
const AUTH_ORIGIN = 'https://ep-misty-snow-123.neonauth.c-4.us-east-2.aws.neon.tech';
const DATABASE_URL =
  'postgresql://u:p@ep-misty-snow-123-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';
const KID = 'kid-1';

let privateKey: KeyObject;
let publicJwk: Record<string, unknown>;

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'EdDSA' };
});

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function token(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const head = b64url({ alg: 'EdDSA', kid: KID });
  const body = b64url({
    sub: 'user-1',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 900,
    ...claims,
  });
  const sig = sign(null, Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

type Verify = (token: string) => Promise<{ sub: string } | null>;

// Same checks, two runtimes: the Vercel verifier and the storage-sign Function copy.
const VERIFIERS: Array<[string, () => void, () => Promise<Verify>]> = [
  [
    'api/authJwt (Vercel)',
    () => vi.stubEnv('VITE_NEON_URL', NEON_URL),
    async () => (await import('../api/authJwt.js')).verifyUserJwt,
  ],
  [
    'storage-sign/authJwt (Function)',
    () => vi.stubEnv('DATABASE_URL', DATABASE_URL),
    async () => (await import('../neon/functions/storage-sign/authJwt.js')).verifyUserJwt,
  ],
];

describe.each(VERIFIERS)('%s', (_name, stubEnv, load) => {
  let verifyUserJwt: Verify;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NEON_AUTH_URL', '');
    vi.stubEnv('NEON_AUTH_BASE_URL', '');
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe(`${AUTH_BASE}/.well-known/jwks.json`);
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }),
    );
    verifyUserJwt = await load();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('accepts a signed-in user token (iss is the bare auth origin)', async () => {
    await expect(verifyUserJwt(token({ iss: AUTH_ORIGIN }))).resolves.toEqual({ sub: 'user-1' });
  });

  it('accepts the auth base URL as issuer too', async () => {
    await expect(verifyUserJwt(token({ iss: AUTH_BASE }))).resolves.toEqual({ sub: 'user-1' });
  });

  it.each([
    ['another project', 'https://ep-other-999.neonauth.c-4.us-east-2.aws.neon.tech'],
    ['a lookalike host', `${AUTH_ORIGIN}.evil.example`],
    ['a trailing slash', `${AUTH_ORIGIN}/`],
    ['no issuer', undefined],
  ])('rejects %s as issuer', async (_label, iss) => {
    await expect(verifyUserJwt(token({ iss }))).resolves.toBeNull();
  });

  it('rejects the anonymous public-fill token', async () => {
    await expect(
      verifyUserJwt(token({ iss: AUTH_BASE, sub: 'anonymous', role: 'anonymous' })),
    ).resolves.toBeNull();
  });

  it('rejects a token signed by a different key', async () => {
    const stranger = generateKeyPairSync('ed25519').privateKey;
    await expect(verifyUserJwt(token({ iss: AUTH_ORIGIN }, stranger))).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    await expect(verifyUserJwt(token({ iss: AUTH_ORIGIN, exp }))).resolves.toBeNull();
  });
});
