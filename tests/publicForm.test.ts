import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({ submitUrl: 'https://fn.test' as string | null }));
vi.mock('../examples/_admin/neon/config.js', () => ({
  getSubmitUrl: () => {
    if (!cfg.submitUrl) throw new Error('VITE_SUBMIT_URL is not configured');
    return cfg.submitUrl;
  },
}));

const row = { id: 'f_1', name: 'Test', slug: '12345678', locked: false, schema: { questions: [] } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  cfg.submitUrl = 'https://fn.test';
  fetchMock = vi.fn(async () => new Response(JSON.stringify(row)));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('public form fetch: one simple GET to the Function (ADR-048, ADR-061)', () => {
  it('one GET with no custom headers (no preflight), no token, no Data API, no SDK', async () => {
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    const form = await loadPublishedForm('12345678');
    expect(form).toEqual(row);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://fn.test/?op=form&slug=12345678');
    expect(init).toEqual({ credentials: 'omit' });
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toBeUndefined();
  });

  it('keeps a path on the Function URL and encodes the slug', async () => {
    cfg.submitUrl = 'https://fn.test/submitresponse';
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    await loadPublishedForm('crew night&x=1');
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://fn.test/submitresponse?op=form&slug=crew+night%26x%3D1',
    );
  });

  it('the entry prefetch and PublicFill share one request', async () => {
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    const [a, b] = await Promise.all([
      loadPublishedForm('12345678'),
      loadPublishedForm('12345678'),
    ]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a locked form comes back without a schema', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ...row, locked: true, schema: null, name: 'Published' })),
    );
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    expect(await loadPublishedForm('12345678')).toEqual({
      id: 'f_1',
      name: 'Published',
      slug: '12345678',
      locked: true,
      schema: null,
    });
  });

  it('404 resolves to null, not an error', async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
    );
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    expect(await loadPublishedForm('00000000')).toBeNull();
  });

  it('429 shows the server’s copy; without one, a friendly line with the wait', async () => {
    const copy =
      'Too many links to forms that don’t exist were opened from this network, so forms are paused here for about 7 minutes. Please try again then, or switch to mobile data.';
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: copy, reason: 'lookup', retryAfterSeconds: 420 }), {
          status: 429,
          headers: { 'Retry-After': '420' },
        }),
    );
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    await expect(loadPublishedForm('12345678')).rejects.toThrow(copy);
    fetchMock.mockImplementationOnce(
      async () => new Response('busy', { status: 429, headers: { 'Retry-After': '90' } }),
    );
    await expect(loadPublishedForm('12345678')).rejects.toThrow(
      /^Too many form links .* about 2 minutes, or switch to mobile data\.$/,
    );
  });

  it('a failure is not memoized — the next call retries', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 503 }));
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    await expect(loadPublishedForm('12345678')).rejects.toThrow(/Could not load/);
    expect((await loadPublishedForm('12345678'))?.id).toBe('f_1');
  });

  it('network error and a malformed body read as plain copy', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    await expect(loadPublishedForm('12345678')).rejects.toThrow(/Check your connection/);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify([row])));
    await expect(loadPublishedForm('12345678')).rejects.toThrow(/try again in a moment/);
  });

  it('no submit URL configured: not available, and nothing is fetched', async () => {
    cfg.submitUrl = null;
    const { loadPublishedForm } = await import('../examples/_admin/neon/publicForm.js');
    await expect(loadPublishedForm('12345678')).rejects.toThrow(
      'This form is not available right now.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
