// @vitest-environment node
/**
 * POST /api/qr-target (ADR-075 §7): the only door to a dynamic QR code's
 * destination. Sign-in, rate, shape, ownership, Web Risk, then set_qr_target
 * with the server key; anything uncertain refuses the save.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/_lib/authJwt.js', () => ({
  verifyUserJwt: vi.fn(async (t: string) => (t === 'good' ? { sub: 'owner-1' } : null)),
}));

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SERVER_KEY = 'a'.repeat(64);

type Row = { id: string; kind: string; deleted_at: string | null; target_url: string | null };
const state = {
  row: null as Row | null,
  webRisk: (() => Response.json({})) as () => Response,
  rpc: (() => Response.json('https://example.com/new')) as (body: unknown) => Response,
  calls: [] as string[],
  rpcBody: null as unknown,
  rpcAuth: '' as string | null,
};

beforeAll(() => {
  vi.stubEnv('VITE_NEON_URL', 'https://ep-test-123.us-east-2.aws.neon.tech/neondb');
  vi.stubEnv('WEB_RISK_API_KEY', 'wr-key');
  vi.stubEnv('QR_SERVER_KEY', SERVER_KEY);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      state.calls.push(`${url.host}${url.pathname}`);
      if (url.host === 'webrisk.googleapis.com') return state.webRisk();
      if (url.pathname.endsWith('/rest/v1/qr_codes')) {
        return Response.json(state.row ? [state.row] : []);
      }
      if (url.pathname.endsWith('/rpc/set_qr_target')) {
        state.rpcBody = JSON.parse(String(init?.body));
        state.rpcAuth = new Headers(init?.headers).get('authorization');
        return state.rpc(state.rpcBody);
      }
      return new Response('unexpected', { status: 500 });
    }),
  );
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

import handler, { QR_TARGET_COPY } from '../api/qr-target.js';
import { checkTargetShape, webRiskLookup } from '../api/_lib/qrTarget.js';
import { resetRateLimit } from '../api/_lib/rateLimit.js';

beforeEach(() => {
  resetRateLimit();
  state.row = { id: ID, kind: 'dynamic', deleted_at: null, target_url: null };
  state.webRisk = () => Response.json({});
  state.rpc = () => Response.json('https://example.com/new');
  state.calls = [];
  state.rpcBody = null;
});

/** A Web Request always gets a Response back (only the Node call writes to `res`). */
const web = async (request: Request) => (await handler(request)) as Response;

const post = (body: unknown, token = 'good', ip = '203.0.113.7') =>
  web(
    new Request('https://slateforms.vercel.app/api/qr-target', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const ok = { id: ID, url: 'https://example.com/new' };

describe('/api/qr-target', () => {
  it('checks with Web Risk, then stores through set_qr_target with the owner’s bearer and the server key', async () => {
    const res = await post(ok);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ target_url: 'https://example.com/new' });
    expect(state.calls).toEqual([
      'ep-test-123.apirest.us-east-2.aws.neon.tech/neondb/rest/v1/qr_codes',
      'webrisk.googleapis.com/v1/uris:search',
      'ep-test-123.apirest.us-east-2.aws.neon.tech/neondb/rest/v1/rpc/set_qr_target',
    ]);
    expect(state.rpcBody).toEqual({ p_id: ID, p_url: ok.url, p_server_key: SERVER_KEY });
    expect(state.rpcAuth).toBe('Bearer good');
  });

  it('refuses without a valid sign-in, before anything else', async () => {
    for (const token of ['', 'forged']) {
      const res = await post(ok, token);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe(QR_TARGET_COPY.signedOut);
    }
    expect(state.calls).toEqual([]);
  });

  it('refuses a bad id or link without a lookup', async () => {
    for (const body of [
      { id: 'nope', url: ok.url },
      { id: ID, url: 'javascript:alert(1)' },
      { id: ID, url: 'https://user:pw@example.com' },
      { id: ID, url: 'https://slateforms.vercel.app/q/abcdefgh' },
      'not json',
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(state.calls).toEqual([]);
  });

  it('spends no Web Risk call on a code that isn’t the caller’s live dynamic code', async () => {
    for (const row of [
      null,
      { id: ID, kind: 'static', deleted_at: null, target_url: 'https://x.io' },
      { id: ID, kind: 'dynamic', deleted_at: '2026-11-01T00:00:00Z', target_url: null },
    ]) {
      state.row = row;
      state.calls = [];
      const res = await post(ok);
      expect(res.status).toBe(404);
      expect(state.calls.some((c) => c.startsWith('webrisk'))).toBe(false);
    }
  });

  it('answers an unchanged link without a check', async () => {
    state.row = { id: ID, kind: 'dynamic', deleted_at: null, target_url: ok.url };
    const res = await post(ok);
    expect(res.status).toBe(200);
    expect(state.calls.some((c) => c.startsWith('webrisk'))).toBe(false);
  });

  it('refuses a flagged link in plain words and never stores it', async () => {
    state.webRisk = () =>
      Response.json({ threat: { threatTypes: ['SOCIAL_ENGINEERING'], expireTime: 'x' } });
    const res = await post(ok);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(QR_TARGET_COPY.unsafe);
    expect(state.rpcBody).toBeNull();
  });

  it('fails closed when Web Risk or the server key is missing', async () => {
    state.webRisk = () => new Response('quota', { status: 429 });
    expect((await post(ok)).status).toBe(503);
    state.webRisk = () => {
      throw new Error('network');
    };
    expect((await post(ok)).status).toBe(503);
    expect(state.rpcBody).toBeNull();

    state.webRisk = () => Response.json({});
    vi.stubEnv('QR_SERVER_KEY', '');
    try {
      expect((await post(ok)).status).toBe(503);
      expect(state.rpcBody).toBeNull();
    } finally {
      vi.stubEnv('QR_SERVER_KEY', SERVER_KEY);
    }
  });

  it('maps the database’s refusals', async () => {
    state.rpc = () =>
      Response.json({ code: 'P0002', message: 'qr target: not found' }, { status: 400 });
    expect((await post(ok)).status).toBe(404);
    state.rpc = () => Response.json({ code: '42501', message: 'key' }, { status: 403 });
    expect((await post(ok)).status).toBe(502);
  });

  it('limits bursts per owner', async () => {
    let last = 200;
    for (let i = 0; i < 11; i++) last = (await post(ok)).status;
    expect(last).toBe(429);
  });

  it('answers Vercel’s Node (req, res) call, not only a Web Request (GS-026)', async () => {
    const body = Buffer.from(JSON.stringify(ok));
    const req = Object.assign(
      (async function* () {
        yield body;
      })(),
      {
        method: 'POST',
        url: '/api/qr-target',
        headers: { host: 'slateforms.vercel.app', 'content-type': 'application/json' },
      },
    );
    const out = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
    await handler(req, {
      set statusCode(v: number) {
        out.statusCode = v;
      },
      get statusCode() {
        return out.statusCode;
      },
      setHeader: (k: string, v: string) => {
        out.headers[k] = v;
      },
      end: (chunk?: unknown) => {
        out.body = Buffer.from(chunk as Buffer).toString('utf8');
      },
    });
    // No bearer: a clean 401 written to the Node response, not a crash.
    expect(out.statusCode).toBe(401);
    expect(JSON.parse(out.body).error).toBe(QR_TARGET_COPY.signedOut);
    expect(out.headers['content-type']).toBe('application/json');
  });

  it('only takes POST', async () => {
    const res = await web(new Request('https://x/api/qr-target', { method: 'GET' }));
    expect(res.status).toBe(405);
  });
});

describe('qrTarget helpers', () => {
  it('passes the threat types and key, and reads clean vs flagged', async () => {
    state.calls = [];
    state.webRisk = () => Response.json({});
    expect(await webRiskLookup('https://example.com')).toEqual({ kind: 'clean' });
    const fetchMock = vi.mocked(fetch);
    const sent = new URL(fetchMock.mock.calls.at(-1)![0] as string);
    expect(sent.searchParams.getAll('threatTypes')).toEqual([
      'MALWARE',
      'SOCIAL_ENGINEERING',
      'UNWANTED_SOFTWARE',
    ]);
    expect(sent.searchParams.get('uri')).toBe('https://example.com');
    expect(sent.searchParams.get('key')).toBe('wr-key');
  });

  it('keeps the same link rules as the database', () => {
    expect(checkTargetShape('https://example.com/a?b=c#d')).toEqual({
      url: 'https://example.com/a?b=c#d',
    });
    expect(checkTargetShape(`https://example.com/${'a'.repeat(2048)}`)).toHaveProperty('problem');
    expect(checkTargetShape('https://exa mple.com')).toHaveProperty('problem');
    expect(checkTargetShape(42)).toHaveProperty('problem');
  });
});
