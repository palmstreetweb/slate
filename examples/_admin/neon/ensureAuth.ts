/**
 * Ensure Neon Auth has a Bearer token ready for Data API / RLS.
 * Session user can exist briefly without access_token — those requests run as
 * anonymous and owner-scoped RLS returns zero rows.
 */

import { getNeon } from './client.js';
import { isRlsOrAuthError } from './neonError.js';

function tokenFromSession(session: unknown): string {
  if (!session || typeof session !== 'object') return '';
  const s = session as Record<string, unknown>;
  if (typeof s.access_token === 'string' && s.access_token) return s.access_token;
  if (typeof s.accessToken === 'string' && s.accessToken) return s.accessToken;
  return '';
}

function emailFromSession(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null;
  const user = (session as Record<string, unknown>).user;
  if (!user || typeof user !== 'object') return null;
  const email = (user as Record<string, unknown>).email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export type ReadyAuth = {
  accessToken: string;
  email: string | null;
};

/**
 * Resolve a usable session token (refreshing if needed). Throws if none.
 */
export async function ensureAuthForDataApi(): Promise<ReadyAuth> {
  const neon = getNeon();
  const auth = neon.auth as {
    getSession: () => Promise<{ data: { session: unknown } | null }>;
    refreshSession?: () => Promise<{ data: { session: unknown } | null; error?: unknown }>;
  };

  let session = (await auth.getSession()).data?.session ?? null;
  let token = tokenFromSession(session);

  if (!token && typeof auth.refreshSession === 'function') {
    try {
      const refreshed = await auth.refreshSession();
      session = refreshed.data?.session ?? session;
      token = tokenFromSession(session);
    } catch {
      // keep trying getSession below
    }
  }

  // Brief races right after OAuth / tab restore.
  for (let i = 0; !token && i < 3; i++) {
    await sleep(120 * (i + 1));
    session = (await auth.getSession()).data?.session ?? null;
    token = tokenFromSession(session);
    if (token) break;
    if (typeof auth.refreshSession === 'function') {
      try {
        const refreshed = await auth.refreshSession();
        session = refreshed.data?.session ?? session;
        token = tokenFromSession(session);
      } catch {
        // continue
      }
    }
  }

  if (!token) {
    // AuthProvider checks with the server and shows Login if the session is gone,
    // instead of leaving a studio where every save fails (login check).
    window.dispatchEvent(new Event('slate-auth-lost'));
    throw new Error('No auth session — cannot load forms.');
  }

  return { accessToken: token, email: emailFromSession(session) };
}

/**
 * Probe that the Data API sees an authenticated user (JWT settled).
 * Empty form libraries are valid for new accounts — do not treat empty as denial.
 */
export async function waitForAuthReady(maxAttempts = 5): Promise<{
  ok: boolean;
  authUid: string | null;
  clientEmail: string | null;
}> {
  const neon = getNeon();
  let clientEmail: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ready = await ensureAuthForDataApi();
    clientEmail = ready.email;

    const { data: uid, error } = await neon.rpc('auth_uid');
    // No token for the Data API yet is "not settled", not a failure — retry below.
    if (error && !isRlsOrAuthError(error)) {
      throw new Error(`${error.message || 'Database access check failed'} — cannot load forms.`);
    }

    const authUid = !error && typeof uid === 'string' && uid ? uid : null;
    if (authUid) {
      return { ok: true, authUid, clientEmail };
    }

    if (attempt < maxAttempts) {
      await sleep(120 * attempt);
      const auth = neon.auth as {
        refreshSession?: () => Promise<unknown>;
      };
      if (typeof auth.refreshSession === 'function') {
        try {
          await auth.refreshSession();
        } catch {
          // continue
        }
      }
    } else {
      return { ok: false, authUid: null, clientEmail };
    }
  }

  return { ok: false, authUid: null, clientEmail };
}

/** @deprecated Use waitForAuthReady — team allowlist gate removed (ADR-036). */
export const waitForTeamAccess = waitForAuthReady;
