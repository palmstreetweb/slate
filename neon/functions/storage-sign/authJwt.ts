/**
 * Verify a Neon Auth user JWT (EdDSA / Ed25519) against the project's JWKS.
 * Returns the subject only when the signature checks out and the token has a
 * future `exp`. Anything else — malformed, unsigned, unknown key, expired,
 * missing exp — is null. Never trust a decoded payload without this.
 */

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

type Jwk = { kid?: string; kty?: string; crv?: string; x?: string; alg?: string };

const JWKS_TTL_MS = 60 * 60 * 1000;
/** Forced-refresh cooldown and failed-fetch backoff (ADR-058, jwks-refetch). */
const RETRY_MS = 60_000;
let cache: { at: number; keys: Jwk[] } | null = null;
const keyObjects = new Map<string, KeyObject>();
/** Last failed fetch of either kind. */
let failedAt = 0;
/** Last SUCCESSFUL forced refresh. */
let forcedAt = 0;
let ttlFetch: Promise<Jwk[]> | null = null;
let forcedFetch: Promise<Jwk[]> | null = null;

/** `NEON_AUTH_URL` (…/neondb/auth), else derived from the DATABASE_URL host. */
export function jwksUrl(): string | null {
  const explicit = process.env.NEON_AUTH_URL?.trim() || process.env.NEON_AUTH_BASE_URL?.trim();
  if (explicit) return `${explicit.replace(/\/$/, '')}/.well-known/jwks.json`;
  const db = process.env.DATABASE_URL;
  if (!db) return null;
  try {
    const u = new URL(db);
    // ep-xxx-pooler.c-4.us-east-2.aws.neon.tech → ep-xxx.neonauth.c-4.us-east-2.aws.neon.tech
    const host = u.hostname.replace(/^([^.]+?)(-pooler)?\./, '$1.neonauth.');
    const dbName = u.pathname.replace(/^\//, '').split('?')[0] || 'neondb';
    return `https://${host}/${dbName}/auth/.well-known/jwks.json`;
  } catch {
    return null;
  }
}

/**
 * Accepted `iss` values. Neon Auth stamps anonymous tokens with the auth base
 * URL (…/neondb/auth) but signed-in user tokens with the bare auth origin
 * (https://ep-….neonauth….neon.tech). Both pin this project's auth host.
 * Null when unknown.
 */
export function issuers(): string[] | null {
  const url = jwksUrl();
  if (!url) return null;
  const base = url.replace(/\/\.well-known\/jwks\.json$/, '');
  try {
    return [base, new URL(base).origin];
  } catch {
    return [base];
  }
}

async function fetchKeys(): Promise<Jwk[]> {
  const url = jwksUrl();
  if (!url) throw new Error('JWKS URL unavailable');
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  cache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
  keyObjects.clear();
  return cache.keys;
}

/** Single-flight per kind. forcedAt is recorded only after a forced fetch succeeds. */
function startFetch(forced: boolean): Promise<Jwk[]> {
  const p = fetchKeys()
    .then((keys) => {
      if (forced) forcedAt = Date.now();
      return keys;
    })
    .catch((err: unknown) => {
      failedAt = Date.now();
      throw err;
    })
    .finally(() => {
      if (forced) forcedFetch = null;
      else ttlFetch = null;
    });
  if (forced) forcedFetch = p;
  else ttlFetch = p;
  return p;
}

/**
 * Cached keys (1 h TTL). An unknown kid forces a refresh at most once per 60 s
 * per instance, so a flood of forged kids costs no network calls. A failed
 * fetch backs off 60 s and serves the stale keys; with nothing cached it throws.
 */
async function loadKeys(force = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!force && cache && now - cache.at < JWKS_TTL_MS) return cache.keys;
  // A forced call joins only another forced fetch, never a TTL refresh that may predate a rotation.
  const running = force ? forcedFetch : ttlFetch;
  if (!running && (now - failedAt < RETRY_MS || (force && now - forcedAt < RETRY_MS))) {
    if (cache) return cache.keys;
    throw new Error('JWKS unavailable');
  }
  try {
    return await (running ?? startFetch(force));
  } catch (err) {
    if (cache) return cache.keys;
    throw err;
  }
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function keyFor(kid: string): Promise<KeyObject | null> {
  const cached = keyObjects.get(kid);
  if (cached) return cached;
  let jwk = (await loadKeys()).find((k) => k.kid === kid);
  // Unknown kid: refetch once in case the project rotated keys.
  if (!jwk) jwk = (await loadKeys(true)).find((k) => k.kid === kid);
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) return null;
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  keyObjects.set(kid, key);
  return key;
}

export async function verifyUserJwt(token: string): Promise<{ sub: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  if (!header || !payload) return null;
  if (header.alg !== 'EdDSA' || typeof header.kid !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now() + 30_000) return null;
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub) return null;
  // The anonymous public-fill token is signed by the same issuer. It is never an owner.
  if (sub === 'anonymous' || payload.role === 'anonymous') return null;
  const expectedIss = issuers();
  if (expectedIss && !expectedIss.includes(payload.iss as string)) return null;
  const key = await keyFor(header.kid);
  if (!key) return null;
  let ok = false;
  try {
    ok = verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch {
    ok = false;
  }
  return ok ? { sub } : null;
}
