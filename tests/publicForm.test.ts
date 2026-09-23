import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../examples/_admin/neon/config.js', () => ({
  getNeonUrl: () => 'https://ep-test.us-east-2.aws.neon.tech/neondb',
  deriveNeonServiceUrls: () => ({
    authUrl: 'https://auth.test/neondb/auth',
    dataApiUrl: 'https://data.test/neondb/rest/v1',
  }),
}));

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const token = (expSec: number) => `${b64({ alg: 'EdDSA' })}.${b64({ role: 'anonymous', exp: expSec })}.sig`;
const row = { id: 'f_1', name: 'Test', slug: '12345678', locked: false, schema: { questions: [] } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  window.sessionStorage.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/token/anonymous')) {
      return new Response(JSON.stringify({ token: token(Math.floor(Date.now() / 1000) + 3600) }));
    }
    return new Response(JSON.stringify([row]));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('public form fetch without the SDK (ADR-048)', () => {
  it('token then RPC — no session call — and never the studio SDK', async () => {
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    const form = await loadPublishedForm('12345678');
    expect(form?.name).toBe('Test');
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      'https://auth.test/neondb/auth/token/anonymous',
      'https://data.test/neondb/rest/v1/rpc/get_form_by_slug',
    ]);
    const init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
    expect(JSON.parse(init.body as string)).toEqual({ p_slug: '12345678' });
  });

  it('the entry prefetch and PublicFill share one request', async () => {
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    const [a, b] = await Promise.all([loadPublishedForm('12345678'), loadPublishedForm('12345678')]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses the cached token on the next visit in this tab', async () => {
    const first = await import('../examples/_admin/neon/publicForm.js');
    await first.loadPublishedForm('12345678');
    vi.resetModules();
    const second = await import('../examples/_admin/neon/publicForm.js');
    await second.loadPublishedForm('87654321');
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.endsWith('/token/anonymous'))).toHaveLength(1);
  });

  it('refetches the token once if the Data API rejects it', async () => {
    let rpcCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/token/anonymous')) {
        return new Response(JSON.stringify({ token: token(Math.floor(Date.now() / 1000) + 3600) }));
      }
      rpcCalls += 1;
      return rpcCalls === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify([row]));
    });
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    expect((await loadPublishedForm('12345678'))?.id).toBe('f_1');
    expect(rpcCalls).toBe(2);
  });

  it('a failure is not memoized — the next call retries', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 503 }));
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    await expect(loadPublishedForm('12345678')).rejects.toThrow(/Could not load/);
    expect((await loadPublishedForm('12345678'))?.id).toBe('f_1');
  });

  it('missing slug resolves to null, not an error', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/token/anonymous')
        ? new Response(JSON.stringify({ token: token(Math.floor(Date.now() / 1000) + 3600) }))
        : new Response('[]'),
    );
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    expect(await loadPublishedForm('00000000')).toBeNull();
  });
});
