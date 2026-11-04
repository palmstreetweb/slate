// @vitest-environment node
/**
 * Dynamic QR short links (ADR-075 §5–6): the edge redirect `api/q.ts` and
 * the `submitresponse` lookup it asks (`GET ?op=qr`, qrScan.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEdgeKey, qrScan } from '../neon/functions/submit-response/qrScan.js';

const KEY = 'k'.repeat(64);
const upstream = vi.fn();
const saved = { key: process.env.QR_EDGE_KEY };

beforeAll(() => {
  process.env.QR_EDGE_KEY = KEY;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => upstream(url, init)),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (saved.key === undefined) delete process.env.QR_EDGE_KEY;
  else process.env.QR_EDGE_KEY = saved.key;
});
beforeEach(() => {
  upstream
    .mockReset()
    .mockImplementation(async () =>
      Response.json({ status: 'ok', target: 'https://example.com/menu', counted: true }),
    );
});

import handler, { COUNT_WINDOW_SEC, PAGE_COPY } from '../api/q.js';

const scan = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  handler(
    new Request(`https://slateforms.vercel.app${path}`, {
      ...init,
      headers: {
        'x-real-ip': '203.0.113.7',
        'user-agent': 'Mozilla/5.0 (iPhone)',
        ...init.headers,
      },
    }),
  );

const lookupUrl = () => new URL(upstream.mock.calls[0]![0] as string);
const lookupHeaders = () =>
  (upstream.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;

describe('api/q edge redirect', () => {
  it('redirects a live code in one hop, counts it, and sets the 30-minute cookie', async () => {
    const res = await scan('/api/q?code=abcdefgh');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/menu');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`slq=1; Max-Age=${COUNT_WINDOW_SEC}; Path=/q/abcdefgh`);
    expect(cookie).toMatch(/Secure; HttpOnly; SameSite=Lax/);
    expect(lookupUrl().searchParams.get('op')).toBe('qr');
    expect(lookupUrl().searchParams.get('count')).toBe('1');
    expect(lookupHeaders()['x-slate-edge-key']).toBe(KEY);
    expect(lookupHeaders()['x-slate-client-ip']).toBe('203.0.113.7');
  });

  it('reads the code from the /q/ path and upper-case scans alike', async () => {
    await scan('/q/ABCDEFGH');
    expect(lookupUrl().searchParams.get('code')).toBe('abcdefgh');
  });

  it('does not count a rescan with the cookie, a HEAD, or a link-preview bot', async () => {
    const again = await scan('/q/abcdefgh', { headers: { cookie: 'other=1; slq=1' } });
    expect(again.status).toBe(302);
    expect(again.headers.get('set-cookie')).toBeNull();
    expect(lookupUrl().searchParams.get('count')).toBe('0');

    upstream.mockClear();
    const head = await scan('/q/abcdefgh', { method: 'HEAD' });
    expect(head.status).toBe(302);
    expect(lookupUrl().searchParams.get('count')).toBe('0');

    upstream.mockClear();
    await scan('/q/abcdefgh', { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } });
    expect(lookupUrl().searchParams.get('count')).toBe('0');
  });

  it('answers a malformed code itself, without a lookup', async () => {
    for (const path of ['/q/abc', '/q/abcdefg1', '/q/abcdefgi', '/q/%3Cscript%3E', '/api/q']) {
      const res = await scan(path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).toContain(PAGE_COPY.not_found.title.replace('’', '’'));
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('shows the inactive and not-found pages from the lookup', async () => {
    upstream.mockImplementation(async () =>
      Response.json({ status: 'inactive', target: null, counted: false }),
    );
    const inactive = await scan('/q/abcdefgh');
    expect(inactive.status).toBe(404);
    expect(inactive.headers.get('content-type')).toMatch(/text\/html/);
    expect(inactive.headers.get('x-robots-tag')).toBe('noindex');
    const html = await inactive.text();
    expect(html).toContain('This code isn’t active right now');
    expect(html).not.toMatch(/<script/i);

    upstream.mockImplementation(async () =>
      Response.json({ status: 'not_found', target: null, counted: false }),
    );
    expect(await (await scan('/q/abcdefgh')).text()).toContain('We couldn’t find that code');
  });

  it('never redirects to a non-web target', async () => {
    upstream.mockImplementation(async () =>
      Response.json({ status: 'ok', target: 'javascript:alert(1)', counted: false }),
    );
    const res = await scan('/q/abcdefgh');
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });

  it('says "try again" (503) when the lookup fails, is refused, or times out', async () => {
    upstream.mockImplementation(async () => new Response('no', { status: 403 }));
    const refused = await scan('/q/abcdefgh');
    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('5');

    upstream.mockImplementation(async () => {
      throw new Error('network');
    });
    expect((await scan('/q/abcdefgh')).status).toBe(503);
  });

  it('fails closed without QR_EDGE_KEY', async () => {
    delete process.env.QR_EDGE_KEY;
    try {
      expect((await scan('/q/abcdefgh')).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      process.env.QR_EDGE_KEY = KEY;
    }
  });

  it('refuses other methods', async () => {
    expect((await scan('/q/abcdefgh', { method: 'POST' })).status).toBe(405);
  });
});

describe('submitresponse op=qr (qrScan)', () => {
  const pool = { query: vi.fn() };
  const ok = (row: Record<string, unknown>) => pool.query.mockResolvedValueOnce({ rows: [row] });
  const input = (over: Partial<Parameters<typeof qrScan>[1]> = {}) => ({
    code: 'abcdefgh',
    count: true,
    edgeKey: KEY,
    clientIp: '203.0.113.7',
    ...over,
  });

  beforeEach(() => pool.query.mockReset());

  it('only trusts a caller with the edge key, and an unset key refuses everyone', () => {
    expect(isEdgeKey(KEY, KEY)).toBe(true);
    expect(isEdgeKey('x'.repeat(64), KEY)).toBe(false);
    expect(isEdgeKey(undefined, KEY)).toBe(false);
    expect(isEdgeKey(KEY, undefined)).toBe(false);
    expect(isEdgeKey('short', 'short')).toBe(false);
  });

  it('is forbidden without the key and reads nothing', async () => {
    expect(await qrScan(pool, input({ edgeKey: 'nope' }))).toEqual({ kind: 'forbidden' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('counts on the forwarded network and returns the target', async () => {
    ok({ status: 'ok', target_url: 'https://example.com', counted: true });
    expect(await qrScan(pool, input())).toEqual({
      kind: 'answer',
      status: 'ok',
      target: 'https://example.com',
      counted: true,
    });
    expect(pool.query.mock.calls[0]![1]).toEqual(['abcdefgh', '203.0.113.7', true]);
  });

  it('opens but does not count without a client IP or when asked not to', async () => {
    ok({ status: 'ok', target_url: 'https://example.com', counted: false });
    await qrScan(pool, input({ clientIp: undefined }));
    expect(pool.query.mock.calls[0]![1]).toEqual(['abcdefgh', null, false]);

    ok({ status: 'ok', target_url: 'https://example.com', counted: false });
    await qrScan(pool, input({ count: false }));
    expect(pool.query.mock.calls[1]![1]).toEqual(['abcdefgh', null, false]);
  });

  it('answers malformed codes without a read', async () => {
    const r = await qrScan(pool, input({ code: 'abc1defg' }));
    expect(r).toEqual({ kind: 'answer', status: 'not_found', target: null, counted: false });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('passes inactive through and treats a non-web target as inactive', async () => {
    ok({ status: 'inactive', target_url: null, counted: false });
    expect(await qrScan(pool, input())).toMatchObject({ status: 'inactive', target: null });
    ok({ status: 'ok', target_url: 'ftp://x', counted: false });
    expect(await qrScan(pool, input())).toMatchObject({ status: 'inactive', target: null });
  });

  it('is unavailable when the database fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('timeout'));
    expect(await qrScan(pool, input())).toEqual({ kind: 'unavailable' });
  });
});
