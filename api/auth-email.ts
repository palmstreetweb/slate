/**
 * Public HTTPS front-door for Neon Auth webhooks (ADR-037).
 * Neon will not call its own Function hosts, so production
 * `https://slateforms.vercel.app/api/auth-email` forwards to `authemail`.
 *
 * Edge + Web Request so the raw body is forwarded byte-for-byte.
 * Signature headers are also copied onto `x-slate-*` aliases because
 * some Neon Function hosts drop inbound `x-neon-*` headers.
 *
 * The Function verifies Neon's detached JWS; this proxy verifies nothing, but
 * it refuses what cannot be a webhook before spending an upstream invocation
 * (audit 2026-10 L-1): no signature headers → 401 here, a body over
 * MAX_BODY_BYTES → 413 here, and an upstream failure is reported in a fixed
 * sentence, never the upstream's own text.
 */

export const config = { runtime: 'edge' };

const TARGET = (
  process.env.AUTH_EMAIL_FUNCTION_URL ||
  'https://br-calm-darkness-ax6lho6c-authemail.compute.c-4.us-east-2.aws.neon.tech'
).replace(/\/$/, '');

/** A webhook is a small JSON event; Neon's largest is well under 4 KB. */
export const MAX_BODY_BYTES = 16 * 1024;

const FORWARD = [
  'content-type',
  'x-neon-signature',
  'x-neon-signature-kid',
  'x-neon-timestamp',
  'x-neon-event-type',
  'x-neon-event-id',
  'x-neon-delivery-attempt',
] as const;

/** The three the Function needs to verify anything. Without all of them it can only answer 401. */
const SIGNATURE_HEADERS = ['x-neon-signature', 'x-neon-signature-kid', 'x-neon-timestamp'] as const;

export const UPSTREAM_FAILED_MESSAGE = 'The sign-in mail service did not accept this event.';

export default async function handler(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === 'GET') {
    return Response.json({ ok: true, service: 'slate-auth-email-proxy' });
  }
  if (method === 'HEAD') {
    return new Response(null, { status: 200 });
  }
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const neonHeaders: Record<string, string> = {};
  for (const name of FORWARD) {
    if (name === 'content-type') continue;
    const value = request.headers.get(name);
    if (value) neonHeaders[name] = value;
  }
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith('x-neon-') && !neonHeaders[lower]) {
      neonHeaders[lower] = value;
    }
  });
  if (SIGNATURE_HEADERS.some((name) => !neonHeaders[name])) {
    // Nothing upstream could do with this but answer 401; don't spend the invocation.
    return Response.json({ error: 'Missing Neon webhook signature headers' }, { status: 401 });
  }

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 });
  }

  console.info('auth-email incoming', {
    bytes: raw.length,
    neonKeys: Object.keys(neonHeaders),
  });

  const headers = new Headers({ 'content-type': 'application/json' });
  for (const [name, value] of Object.entries(neonHeaders)) {
    headers.set(name, value);
    if (name.startsWith('x-neon-')) {
      headers.set(`x-slate-${name.slice('x-neon-'.length)}`, value);
    }
  }

  const upstream = await fetch(`${TARGET}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      slateProxy: 1,
      rawBody: raw,
      headers: neonHeaders,
    }),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    // The Function's own wording stays in our log; the caller gets one fixed line.
    console.error('authemail upstream', upstream.status, text.slice(0, 300));
    return Response.json({ error: UPSTREAM_FAILED_MESSAGE }, { status: upstream.status });
  }
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  });
}
