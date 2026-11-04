/**
 * Neon Data API from server code, as the signed-in user (ADR-051).
 * The caller's own bearer is forwarded, so `auth_uid()` and RLS see that user —
 * there is no service role and no secret in this file.
 */

/**
 * `…/neondb/rest/v1`, derived from `VITE_NEON_URL` the same way `jwksUrl()` in
 * `authJwt.ts` derives the auth URL. Mirrors deriveNeonServiceUrls() in
 * examples/_admin/neon/config.ts: ep-x.region.aws.neon.tech → ep-x.apirest.….
 */
export function neonDataApiUrl(): string | null {
  const base = process.env.VITE_NEON_URL?.trim();
  if (!base) return null;
  try {
    const u = new URL(base);
    const dbPath = u.pathname.replace(/\/$/, '') || '/neondb';
    const host = u.hostname.includes('.apirest.')
      ? u.hostname
      : u.hostname.replace(/^([^.]+)\./, '$1.apirest.');
    return `${u.protocol}//${host}${dbPath}/rest/v1`;
  } catch {
    return null;
  }
}

const RPC_TIMEOUT_MS = 8000;

/** A non-2xx answer: the HTTP status and, when the body had one, the Postgres error code. */
export class DataApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'DataApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * POST `/rpc/{fn}` with the user's bearer and return the parsed JSON body.
 * Throws on anything else — no URL, network, timeout, non-2xx, non-JSON — and
 * leaves fail-open vs fail-closed to the caller. Error text never holds the token.
 */
export async function callDataApiRpc(
  fn: string,
  token: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const base = neonDataApiUrl();
  if (!base) throw new Error(`${fn}: VITE_NEON_URL is not set`);
  const scrub = (text: string) => (token ? text.split(token).join('[token]') : text);

  let res: Response;
  try {
    res = await fetch(`${base}/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error ? `${err.name}: ${err.message}` : 'network error';
    throw new Error(scrub(`${fn}: ${why}`));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let code: string | null = null;
    try {
      const parsed = JSON.parse(text) as { code?: unknown };
      if (typeof parsed.code === 'string') code = parsed.code;
    } catch {
      // Not JSON: no code.
    }
    throw new DataApiError(
      scrub(`${fn}: HTTP ${res.status} ${text.slice(0, 200)}`.trim()),
      res.status,
      code,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`${fn}: response was not JSON`);
  }
}
