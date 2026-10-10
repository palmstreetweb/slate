// @vitest-environment node
/**
 * `/api/auth-email` forwards Neon Auth webhooks to the authemail Function.
 * It spends no upstream invocation on what cannot be a webhook, caps the
 * body, and never relays the upstream's own error text (audit 2026-10 L-1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const upstream = vi.fn();

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => upstream(url, init)),
  );
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  upstream.mockReset().mockImplementation(async () => Response.json({ ok: true, sent: true }));
});

import handler, { MAX_BODY_BYTES, UPSTREAM_FAILED_MESSAGE } from '../api/auth-email.js';

const SIGNED = {
  'x-neon-signature': 'sig',
  'x-neon-signature-kid': 'k1',
  'x-neon-timestamp': '1700000000',
  'x-neon-event-type': 'send.otp',
};

const post = (body: string, headers: Record<string, string> = SIGNED) =>
  handler(
    new Request('https://slateforms.vercel.app/api/auth-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    }),
  );

describe('/api/auth-email', () => {
  it('forwards a signed event byte-for-byte with the x-neon-* headers and x-slate-* aliases', async () => {
    const res = await post('{"event_type":"send.otp"}');
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [, init] = upstream.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-neon-signature')).toBe('sig');
    expect(headers.get('x-slate-signature-kid')).toBe('k1');
    expect(JSON.parse(String(init.body))).toMatchObject({
      slateProxy: 1,
      rawBody: '{"event_type":"send.otp"}',
    });
  });

  it.each([
    ['no headers at all', {}],
    ['a signature but no kid', { 'x-neon-signature': 'sig', 'x-neon-timestamp': '1' }],
    ['a kid but no signature', { 'x-neon-signature-kid': 'k1', 'x-neon-timestamp': '1' }],
    ['no timestamp', { 'x-neon-signature': 'sig', 'x-neon-signature-kid': 'k1' }],
  ])('answers 401 itself and calls nothing upstream when %s', async (_label, headers) => {
    const res = await post('{}', headers);
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a body over 16 KB with 413 before forwarding', async () => {
    const res = await post('x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
    expect((await post('x'.repeat(MAX_BODY_BYTES))).status).toBe(200);
  });

  it('refuses by Content-Length too, without reading the body', async () => {
    const res = await handler(
      new Request('https://slateforms.vercel.app/api/auth-email', {
        method: 'POST',
        headers: { ...SIGNED, 'content-length': String(MAX_BODY_BYTES + 1) },
        body: 'small',
      }),
    );
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('relays an upstream failure as one fixed sentence, keeping the status', async () => {
    upstream.mockImplementation(
      async () => new Response('{"error":"RESEND_API_KEY is not set"}', { status: 500 }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post('{}');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: UPSTREAM_FAILED_MESSAGE });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('GET is the service banner and other methods are 405', async () => {
    const get = await handler(new Request('https://x/api/auth-email', { method: 'GET' }));
    expect(get.status).toBe(200);
    const put = await handler(new Request('https://x/api/auth-email', { method: 'PUT' }));
    expect(put.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
});
