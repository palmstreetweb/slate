/**
 * `POST /api/qr-target` `{ id, url }` (ADR-075 §7): the only way a dynamic QR
 * code's destination changes. Otherwise anyone with an account could turn the
 * short-link domain into a redirector for phishing, Google would flag the
 * domain, and every Slate form would open behind a red warning page.
 *
 * Order, cheapest first, so nothing is spent on a request that can't succeed:
 *   1. the owner's JWT (401), a per-owner and per-network burst guard (429);
 *   2. the link rules, the same as the database's (400);
 *   3. the code is the caller's own, dynamic and not in Trash (404), read over
 *      the Data API with the caller's bearer, so RLS decides; an unchanged
 *      link is answered without a check;
 *   4. Google Web Risk (MALWARE, SOCIAL_ENGINEERING, UNWANTED_SOFTWARE): a
 *      match is refused in plain words (422); no answer is a 503 (fail closed);
 *   5. `set_qr_target(id, url, QR_SERVER_KEY)` with the caller's bearer, so
 *      `auth_uid()` is still the owner and the key proves the check ran.
 */

import { clientIp, takeRateLimit } from './_lib/rateLimit.js';
import { verifyUserJwt } from './_lib/authJwt.js';
import { callDataApiRpc, DataApiError, neonDataApiUrl } from './_lib/neonDataApi.js';
import { checkTargetShape, webRiskLookup } from './_lib/qrTarget.js';
import { nodeOrWeb } from './_lib/webHandler.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_CHARS = 8 * 1024;

export const QR_TARGET_COPY = {
  signedOut: 'Your sign-in expired. Sign out and back in, then try again.',
  busy: 'That’s a lot of link changes at once. Wait a minute, then try again.',
  badRequest: 'Something went wrong sending that. Reload the page and try again.',
  notFound: 'That QR code isn’t here anymore, or it’s in Trash.',
  unsafe:
    'Google lists this link as unsafe (phishing or harmful software), so Slate won’t send people there. Check the link, or use a different one.',
  unavailable: 'Slate can’t check links right now. Try again in a minute.',
  failed: 'Couldn’t save the link. Try again.',
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

type CodeRow = { id: string; kind: string; deleted_at: string | null; target_url: string | null };

/** The caller's own row (RLS: owner only), or null. Throws when the Data API can't answer. */
async function ownCode(id: string, token: string): Promise<CodeRow | null> {
  const base = neonDataApiUrl();
  if (!base) throw new Error('VITE_NEON_URL is not set');
  const res = await fetch(
    `${base}/qr_codes?id=eq.${id}&select=id,kind,deleted_at,target_url&limit=1`,
    {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) throw new Error(`qr_codes read: HTTP ${res.status}`);
  const rows = (await res.json()) as CodeRow[];
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function handleQrTarget(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = /^Bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  const claims = token ? await verifyUserJwt(token).catch(() => null) : null;
  if (!claims) return json({ error: QR_TARGET_COPY.signedOut }, 401);

  // Burst guard per instance. Each pass can cost one Web Risk call, so per owner first.
  if (!takeRateLimit(`qr:${claims.sub}`) || !takeRateLimit(`qrip:${clientIp(request)}`)) {
    return json({ error: QR_TARGET_COPY.busy }, 429);
  }

  let id: unknown;
  let rawUrl: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return json({ error: QR_TARGET_COPY.badRequest }, 400);
    const body = JSON.parse(text) as Record<string, unknown>;
    id = body?.id;
    rawUrl = body?.url;
  } catch {
    return json({ error: QR_TARGET_COPY.badRequest }, 400);
  }
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return json({ error: QR_TARGET_COPY.badRequest }, 400);
  }
  const shape = checkTargetShape(rawUrl);
  if ('problem' in shape) return json({ error: shape.problem }, 400);
  const url = shape.url;

  let row: CodeRow | null;
  try {
    row = await ownCode(id, token);
  } catch (err) {
    console.error('[qr-target] code read failed', String(err).slice(0, 200));
    return json({ error: QR_TARGET_COPY.failed }, 502);
  }
  if (!row || row.kind !== 'dynamic' || row.deleted_at) {
    return json({ error: QR_TARGET_COPY.notFound }, 404);
  }
  if (row.target_url === url) return json({ target_url: url, unchanged: true });

  const verdict = await webRiskLookup(url);
  if (verdict.kind === 'flagged') {
    console.warn('[qr-target] refused a flagged link', {
      sub: claims.sub,
      threats: verdict.threats,
    });
    return json({ error: QR_TARGET_COPY.unsafe, threats: verdict.threats }, 422);
  }
  if (verdict.kind === 'unavailable') {
    console.error('[qr-target] Web Risk unavailable:', verdict.reason);
    return json({ error: QR_TARGET_COPY.unavailable }, 503);
  }

  const serverKey = process.env.QR_SERVER_KEY?.trim();
  if (!serverKey) {
    console.error('[qr-target] QR_SERVER_KEY is not set');
    return json({ error: QR_TARGET_COPY.unavailable }, 503);
  }
  try {
    const stored = await callDataApiRpc('set_qr_target', token, {
      p_id: id,
      p_url: url,
      p_server_key: serverKey,
    });
    return json({ target_url: typeof stored === 'string' ? stored : url });
  } catch (err) {
    if (err instanceof DataApiError) {
      // P0002: not the owner's live dynamic code (it moved to Trash meanwhile).
      if (err.code === 'P0002') return json({ error: QR_TARGET_COPY.notFound }, 404);
      // 23514: the database's own link rule. The shape check above should have caught it.
      if (err.code === '23514') return json({ error: QR_TARGET_COPY.badRequest }, 400);
      // 42501: the server key didn't match the database's. A deploy problem, not the owner's.
      if (err.code === '42501')
        console.error('[qr-target] QR_SERVER_KEY does not match qr_server_key');
    }
    console.error('[qr-target] set_qr_target failed', String(err).slice(0, 200));
    return json({ error: QR_TARGET_COPY.failed }, 502);
  }
}

/** Vercel calls Node functions with (req, res); tests call with a Request (GS-026). */
export default nodeOrWeb(handleQrTarget, '/api/qr-target');
