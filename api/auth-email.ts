/**
 * Public HTTPS front-door for Neon Auth webhooks (ADR-037).
 * Neon will not call its own Function hosts, so production
 * `https://slateforms.vercel.app/api/auth-email` forwards to `authemail`.
 *
 * Edge + Web Request so the raw body is forwarded byte-for-byte.
 * Signature headers are also copied onto `x-slate-*` aliases because
 * some Neon Function hosts drop inbound `x-neon-*` headers.
 */

export const config = { runtime: 'edge' };

const TARGET = (
  process.env.AUTH_EMAIL_FUNCTION_URL ||
  'https://br-calm-darkness-ax6lho6c-authemail.compute.c-4.us-east-2.aws.neon.tech'
).replace(/\/$/, '');

const FORWARD = [
  'content-type',
  'x-neon-signature',
  'x-neon-signature-kid',
  'x-neon-timestamp',
  'x-neon-event-type',
  'x-neon-event-id',
  'x-neon-delivery-attempt',
] as const;

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

  const raw = await request.text();
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
  console.info('auth-email incoming', {
    bytes: raw.length,
    neonKeys: Object.keys(neonHeaders),
    hasSignature: Boolean(neonHeaders['x-neon-signature']),
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
    console.error('authemail upstream', upstream.status, text.slice(0, 300));
  }
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
    },
  });
}
