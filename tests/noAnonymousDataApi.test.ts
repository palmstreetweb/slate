import { afterEach, describe, expect, it, vi } from 'vitest';

// Owner report 2026-09-24: first load after Google sign-in showed every form at
// "0 responses" (refresh fixed it). Reads sent before the session token settled
// went out with an anonymous JWT, and owner-only RLS answered "0 rows".

const created = vi.hoisted(() => ({ opts: null as unknown }));
vi.mock('@neondatabase/neon-js', () => ({
  createClient: (_url: string, opts: unknown) => {
    created.opts = opts;
    return { auth: {} };
  },
  SupabaseAuthAdapter: () => ({}),
}));
vi.mock('../examples/_admin/neon/config.js', () => ({
  getNeonUrl: () => 'https://ep-x.c-4.us-east-2.aws.neon.tech/neondb',
}));

afterEach(() => {
  vi.doUnmock('../examples/_admin/neon/client.js');
  vi.resetModules();
});

describe('studio Data API never falls back to anonymous', () => {
  it('creates the client without allowAnonymous', async () => {
    const { getNeon } = await import('../examples/_admin/neon/env.js');
    getNeon();
    const auth = (created.opts as { auth: Record<string, unknown> }).auth;
    expect(auth.allowAnonymous).toBeFalsy();
  });

  it('treats the SDK’s "no token yet" error as an auth error to retry', async () => {
    const { isRlsOrAuthError } = await import('../examples/_admin/neon/neonError.js');
    expect(
      isRlsOrAuthError({
        message:
          'AuthRequiredError: Authentication required. A valid token is needed to access the resource.',
        code: '',
      }),
    ).toBe(true);
  });

  it('waitForAuthReady retries through "no token yet" instead of failing', async () => {
    let calls = 0;
    vi.doMock('../examples/_admin/neon/client.js', () => ({
      getNeon: () => ({
        auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
        rpc: async () =>
          ++calls < 3
            ? {
                data: null,
                error: { message: 'AuthRequiredError: Authentication required.', code: '' },
              }
            : { data: 'owner-1', error: null },
      }),
    }));
    const { waitForAuthReady } = await import('../examples/_admin/neon/ensureAuth.js');
    await expect(waitForAuthReady(5)).resolves.toMatchObject({ ok: true, authUid: 'owner-1' });
    expect(calls).toBe(3);
  });

  it('a real database error still fails straight away', async () => {
    vi.doMock('../examples/_admin/neon/client.js', () => ({
      getNeon: () => ({
        auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
        rpc: async () => ({ data: null, error: { message: 'relation does not exist' } }),
      }),
    }));
    const { waitForAuthReady } = await import('../examples/_admin/neon/ensureAuth.js');
    await expect(waitForAuthReady(5)).rejects.toThrow(/relation does not exist/);
  });
});
