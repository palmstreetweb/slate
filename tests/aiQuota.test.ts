// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const TOKEN = vi.hoisted(() => 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl');
const verifyUserJwt = vi.hoisted(() => vi.fn());
const runGenerateForm = vi.hoisted(() => vi.fn());

vi.mock('../api/authJwt.js', () => ({ verifyUserJwt }));
// runGenerateForm is the only path to Anthropic. If it's never called, the key never spends.
const GenerateTimeoutError = vi.hoisted(
  () =>
    class GenerateTimeoutError extends Error {
      constructor() {
        super('That took too long. Try a shorter PDF or a shorter description.');
      }
    },
);
vi.mock('../api/runGenerate.js', () => ({
  runGenerateForm,
  GenerateValidationError: class GenerateValidationError extends Error {},
  GenerateTimeoutError,
}));
vi.mock('../examples/_admin/storageUpload.js', () => ({
  authHeader: async () => ({ Authorization: `Bearer ${TOKEN}` }),
}));

import handler, {
  AI_QUOTA_GLOBAL_MESSAGE,
  AI_QUOTA_UNAVAILABLE_MESSAGE,
  AI_QUOTA_USER_MESSAGE,
} from '../api/generate.js';
import { neonDataApiUrl } from '../api/neonDataApi.js';
import { resetRateLimit } from '../api/rateLimit.js';
import { requestGeneratedForm } from '../examples/_admin/ai/client.js';
import { deriveNeonServiceUrls } from '../examples/_admin/neon/config.js';

const NEON_URL = 'https://ep-cool-rain-123.us-east-2.aws.neon.tech/neondb';
const RPC_URL =
  'https://ep-cool-rain-123.apirest.us-east-2.aws.neon.tech/neondb/rest/v1/rpc/consume_ai_generation';
const FORM = { title: 'Wedding RSVP' };

function post(
  body: Record<string, unknown> = { prompt: 'Wedding RSVP' },
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
): Request {
  return new Request('https://slateforms.vercel.app/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}

const call = async (req: Request) => (await handler(req)) as Response;

const quotaRow = (row: Record<string, unknown>) =>
  new Response(JSON.stringify([row]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;
let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VITE_NEON_URL', NEON_URL);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  vi.stubEnv('AI_QUOTA_KEY', 'server-key-123');
  verifyUserJwt.mockReset().mockResolvedValue({ sub: 'user-1' });
  runGenerateForm.mockReset().mockResolvedValue(FORM);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

describe('Build with AI daily cap (ADR-051)', () => {
  it('consumes one unit as the caller, then generates', async () => {
    fetchMock.mockResolvedValue(
      quotaRow({ allowed: true, used: 1, per_user_daily: 25, global_used: 1 }),
    );
    const res = await call(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ form: FORM, prompt: 'Wedding RSVP' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RPC_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    // The server key proves the call came from /api/generate, not a browser.
    expect(JSON.parse(init.body as string)).toEqual({ p_server_key: 'server-key-123' });
    expect(runGenerateForm).toHaveBeenCalledTimes(1);
  });

  it('fails closed without AI_QUOTA_KEY and never calls the database or the model', async () => {
    vi.stubEnv('AI_QUOTA_KEY', '');
    const res = await call(post());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: AI_QUOTA_UNAVAILABLE_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('a wrong or unsigned-in call (the RPC raises 42501) is a 503, not "limit reached"', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"code":"42501","message":"ai quota: not signed in"}', { status: 403 }),
    );
    const res = await call(post());
    expect(res.status).toBe(503);
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('429s with the daily-limit message and never reaches the model', async () => {
    fetchMock.mockResolvedValue(
      quotaRow({ allowed: false, used: 25, per_user_daily: 25, global_used: 140 }),
    );
    const res = await call(post());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: AI_QUOTA_USER_MESSAGE });
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('says the shared ceiling is full when the caller is under their own cap', async () => {
    fetchMock.mockResolvedValue(
      quotaRow({ allowed: false, used: 3, per_user_daily: 25, global_used: 500 }),
    );
    const res = await call(post());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: AI_QUOTA_GLOBAL_MESSAGE });
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it.each([
    [
      'migration 014 not applied (404)',
      () =>
        new Response('{"code":"PGRST202","message":"Could not find the function"}', {
          status: 404,
        }),
    ],
    ['Data API 5xx', () => new Response('upstream error', { status: 502 })],
    ['permission denied (403)', () => new Response('{"code":"42501"}', { status: 403 })],
    ['empty result', () => new Response('[]', { status: 200 })],
    ['not JSON', () => new Response('<html>', { status: 200 })],
    ['a row without allowed', () => quotaRow({ used: 1 })],
  ])('fails closed with 503 when %s', async (_label, respond) => {
    fetchMock.mockImplementation(async () => respond());
    const res = await call(post());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: AI_QUOTA_UNAVAILABLE_MESSAGE });
    expect(runGenerateForm).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('fails closed on a network error or timeout', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await call(post());
    expect(res.status).toBe(503);
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('fails closed when VITE_NEON_URL is missing, without calling out', async () => {
    vi.stubEnv('VITE_NEON_URL', undefined);
    const res = await call(post());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('never logs the bearer, even when the upstream echoes it', async () => {
    fetchMock.mockResolvedValue(new Response(`bad jwt ${TOKEN}`, { status: 401 }));
    const res = await call(post());
    expect(res.status).toBe(503);
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(TOKEN);
  });

  it('does not spend a unit on a request that was going to 400', async () => {
    const res = await call(post({ prompt: '' }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsigned callers before the quota is touched', async () => {
    const res = await call(post({ prompt: 'Wedding RSVP' }, {}));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('skips the quota in the Vite dev bypass', async () => {
    vi.stubEnv('VERCEL', undefined);
    const res = await call(post({ prompt: 'Wedding RSVP' }, { 'x-slate-dev': '1' }));
    expect(res.status).toBe(200);
    expect(verifyUserJwt).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runGenerateForm).toHaveBeenCalledTimes(1);
  });

  it('ignores the dev header on Vercel', async () => {
    const res = await call(post({ prompt: 'Wedding RSVP' }, { 'x-slate-dev': '1' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Build with AI input caps (audit M-AI-1 / M-AI-2)', () => {
  const allowed = () => quotaRow({ allowed: true, used: 1, per_user_daily: 25, global_used: 1 });
  const notAPdf = { filename: 'notes.pdf', base64: Buffer.from('hello world').toString('base64') };

  it('caps the typed prompt even when a PDF is attached, before the quota', async () => {
    const res = await call(post({ prompt: 'x'.repeat(2001), document: notAPdf }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('charges the daily cap before parsing a PDF', async () => {
    fetchMock.mockResolvedValue(allowed());
    const res = await call(
      post({ prompt: '', document: { ...notAPdf, mime: 'text/plain', filename: 'notes.txt' } }),
    );
    // Rejected by the cheap shape check first — no unit spent.
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const pdf = await call(post({ prompt: '', document: notAPdf }));
    // Passes the shape check, so the unit is taken, then parsing fails.
    expect(pdf.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('ignores a document sent with a revision instead of re-reading it', async () => {
    const res = await call(
      post({
        prompt: 'Wedding RSVP',
        instruction: 'Add a meal choice',
        previous: { title: 'RSVP' },
        // Oversized on purpose: if it were parsed this would be the PDF-size error.
        document: { filename: 'x.pdf', base64: 'A'.repeat(4_300_000) },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toMatch(/PDF/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a deadline so a slow draft never hits the Vercel kill', async () => {
    fetchMock.mockResolvedValue(allowed());
    const before = Date.now();
    await call(post());
    const { deadline } = runGenerateForm.mock.calls[0]![0] as { deadline: number };
    expect(deadline).toBeGreaterThan(before + 100_000);
    expect(deadline).toBeLessThan(before + 180_000);
  });

  it('answers a timed-out draft with a clear message', async () => {
    fetchMock.mockResolvedValue(allowed());
    runGenerateForm.mockRejectedValue(new GenerateTimeoutError());
    const res = await call(post());
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/took too long/);
  });
});

describe('neonDataApiUrl', () => {
  it('matches the SPA derivation', () => {
    expect(neonDataApiUrl()).toBe(
      'https://ep-cool-rain-123.apirest.us-east-2.aws.neon.tech/neondb/rest/v1',
    );
    expect(neonDataApiUrl()).toBe(deriveNeonServiceUrls(NEON_URL).dataApiUrl);
  });

  it('handles a trailing slash, an apirest host, and junk', () => {
    vi.stubEnv('VITE_NEON_URL', `${NEON_URL}/`);
    expect(neonDataApiUrl()).toBe(
      'https://ep-cool-rain-123.apirest.us-east-2.aws.neon.tech/neondb/rest/v1',
    );
    vi.stubEnv('VITE_NEON_URL', 'https://ep-x.apirest.us-east-2.aws.neon.tech/neondb');
    expect(neonDataApiUrl()).toBe('https://ep-x.apirest.us-east-2.aws.neon.tech/neondb/rest/v1');
    vi.stubEnv('VITE_NEON_URL', 'not a url');
    expect(neonDataApiUrl()).toBeNull();
    vi.stubEnv('VITE_NEON_URL', '');
    expect(neonDataApiUrl()).toBeNull();
  });
});

describe('Build with AI client', () => {
  // Route the client's relative fetch through the real handler.
  function wireClientToHandler(rpc: () => Response) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/generate') {
        return call(new Request(`https://slateforms.vercel.app${url}`, init));
      }
      if (url === RPC_URL) return rpc();
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it('surfaces the daily-limit message as-is', async () => {
    wireClientToHandler(() =>
      quotaRow({ allowed: false, used: 25, per_user_daily: 25, global_used: 90 }),
    );
    await expect(requestGeneratedForm({ prompt: 'Wedding RSVP' })).rejects.toMatchObject({
      message: AI_QUOTA_USER_MESSAGE,
    });
    expect(runGenerateForm).not.toHaveBeenCalled();
  });

  it('surfaces the unavailable message as-is', async () => {
    wireClientToHandler(() => new Response('', { status: 404 }));
    await expect(requestGeneratedForm({ prompt: 'Wedding RSVP' })).rejects.toMatchObject({
      message: AI_QUOTA_UNAVAILABLE_MESSAGE,
    });
  });
});
