'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deriveNeonServiceUrls, getNeon, getNeonUrl, isNeonConfigured } from './env.js';
import { clearRemoteStores } from './hydrate.js';
import { playUiSound } from '../uiSounds.js';

type AuthUser = {
  id: string;
  email?: string | null;
};

type AuthSession = {
  access_token: string;
  user: AuthUser;
};

type AuthState = {
  loading: boolean;
  session: AuthSession | null;
  user: AuthUser | null;
  /** True when signed in with a usable session (ADR-036 open signup). */
  isPswTeam: boolean;
};

type AuthContextValue = AuthState & {
  authError: string | null;
  signInWithEmail: (email: string) => Promise<{ error: string | null; magicLinkSent: boolean }>;
  verifyEmailOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  /** Resolves once the server confirms. On `{ error }` the owner is still signed in. */
  signOut: () => Promise<{ error: string | null }>;
  clearAuthError: () => void;
  /** Sign-in service unreachable at boot (network / 429 / 5xx) — not the same as signed out. */
  authUnreachable: boolean;
  retryAuth: () => void;
};

const BOOT_RETRY_DELAYS_MS = [400, 1200, 2500];
const SIGN_OUT_TIMEOUT_MS = 10_000;
/** Fired by the Data API layer when it has no usable token (ensureAuth.ts). */
export const AUTH_LOST_EVENT = 'slate-auth-lost';

const AuthContext = createContext<AuthContextValue | null>(null);

/** Where Google and magic-link sign-in should land. Must match a Neon trusted origin. */
function authRedirectUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  // Stay on the site the user is actually using (local or production).
  // Sign-in always lands on the dashboard; the callback is the origin root.
  return `${window.location.origin}/`;
}

function friendlyAuthSendError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/invalid callbackurl/i.test(t) || /^HTTP\s*403$/i.test(t)) {
    return 'This site is not allowed to finish sign-in yet. Use https://slateforms.vercel.app, or http://127.0.0.1:5173 / http://localhost:5173 for local.';
  }
  return t;
}

function normalizeSession(raw: unknown): AuthSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const userRaw = s.user as Record<string, unknown> | undefined;
  if (!userRaw || typeof userRaw.id !== 'string') return null;
  const access =
    (typeof s.access_token === 'string' && s.access_token) ||
    (typeof s.accessToken === 'string' && s.accessToken) ||
    '';
  // Without a token the Data API cannot authenticate — treat as signed out.
  if (!access) return null;
  return {
    access_token: access,
    user: {
      id: userRaw.id,
      email: typeof userRaw.email === 'string' ? userRaw.email : null,
    },
  };
}

const NO_EMAIL_MSG =
  'This sign-in has no email address. Use Google or an email code instead.';

const VERIFY_TIMEOUT_MS = 18_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(id);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(id);
        reject(err);
      },
    );
  });
}

type SessionClient = {
  getSession: (opts?: { forceFetch?: boolean }) => Promise<{ data: { session: unknown } | null }>;
};

async function readUsableSession(auth: SessionClient): Promise<AuthSession | null> {
  const first = normalizeSession((await auth.getSession({ forceFetch: true })).data?.session ?? null);
  if (first) return first;
  await sleep(160);
  return normalizeSession((await auth.getSession({ forceFetch: true })).data?.session ?? null);
}

type MagicLinkClient = {
  getBetterAuthInstance?: () => {
    signIn: {
      magicLink: (args: {
        email: string;
        callbackURL?: string;
        newUserCallbackURL?: string;
        errorCallbackURL?: string;
      }) => Promise<{ error?: { message?: string } | null }>;
    };
  };
};

async function requestMagicLink(
  auth: MagicLinkClient,
  email: string,
  callbackURL?: string,
): Promise<{ error?: { message?: string } | null }> {
  const viaSdk = auth.getBetterAuthInstance?.()?.signIn?.magicLink;
  if (viaSdk) {
    return viaSdk({
      email,
      callbackURL,
      newUserCallbackURL: callbackURL,
      errorCallbackURL: callbackURL,
    });
  }

  const neonUrl = getNeonUrl();
  if (!neonUrl) throw new Error('Magic link client is unavailable.');
  const { authUrl } = deriveNeonServiceUrls(neonUrl);
  const res = await fetch(`${authUrl}/sign-in/magic-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      callbackURL,
      newUserCallbackURL: callbackURL,
      errorCallbackURL: callbackURL,
    }),
  });
  const body = (await res.json().catch(() => null)) as
    | { message?: string; error?: { message?: string } | string }
    | null;
  if (!res.ok) {
    const message = friendlyAuthSendError(
      (typeof body?.error === 'object' && body.error?.message) ||
        (typeof body?.error === 'string' && body.error) ||
        body?.message ||
        `HTTP ${res.status}`,
    );
    return { error: { message: message ?? 'Could not send a sign-in link.' } };
  }
  return { error: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isNeonConfigured());
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authUnreachable, setAuthUnreachable] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const hydrateDoneRef = useRef(false);
  const wasSignedInRef = useRef(false);
  /** Whose data is in the in-memory stores. Any change of user clears them first. */
  const userIdRef = useRef<string | null>(null);
  /** While a sign-out is in flight, a late "signed in" event must not undo it. */
  const signingOutRef = useRef(false);

  /**
   * Every session change goes through here. Switching accounts (or signing out
   * in another tab) clears the previous owner's forms and responses before
   * anything renders — otherwise the next account could see them.
   */
  const applySession = useCallback((next: AuthSession | null) => {
    if (next && signingOutRef.current) return;
    const nextId = next?.user.id ?? null;
    if (userIdRef.current !== null && userIdRef.current !== nextId) clearRemoteStores();
    userIdRef.current = nextId;
    setSession(next);
  }, []);

  useEffect(() => {
    if (!isNeonConfigured()) {
      setLoading(false);
      return;
    }
    const neon = getNeon();
    let mounted = true;
    const auth = neon.auth as SessionClient & {
      onAuthStateChange: (
        cb: (event: string, session: unknown) => void,
      ) => { data: { subscription: { unsubscribe: () => void } } };
      getBetterAuthInstance?: () => {
        useSession?: {
          subscribe: (
            cb: (value: { data?: { session?: unknown; user?: unknown } | null }) => void,
          ) => void | (() => void);
        };
      };
    };

    // Boot: tell "signed out" apart from "couldn't ask". A failed check used to
    // show a signed-in owner the Login screen with no message (login check).
    let bootSettled = false;
    const boot = async () => {
      for (let attempt = 0; ; attempt++) {
        let failed = false;
        try {
          const res = (await auth.getSession()) as {
            data: { session: unknown } | null;
            error?: unknown;
          };
          if (!mounted) return;
          if (!res.error) {
            bootSettled = true;
            setAuthUnreachable(false);
            applySession(normalizeSession(res.data?.session ?? null));
            setLoading(false);
            return;
          }
          failed = true;
        } catch {
          failed = true;
        }
        if (!mounted) return;
        if (failed && attempt >= BOOT_RETRY_DELAYS_MS.length) {
          bootSettled = true;
          setAuthUnreachable(true);
          setLoading(false);
          return;
        }
        await sleep(BOOT_RETRY_DELAYS_MS[attempt]!);
        if (!mounted) return;
      }
    };
    void boot();

    const { data: sub } = auth.onAuthStateChange((_event, next) => {
      // Neon’s adapter only emits this for the first subscribe + other tabs.
      // A successful same-tab OTP still needs getSession() in verifyEmailOtp.
      if (!mounted) return;
      const normalized = normalizeSession(next);
      // The adapter also fires a null INITIAL_SESSION when the boot check fails;
      // until boot settles, only a real session is worth applying.
      if (!normalized && !bootSettled) return;
      applySession(normalized);
      if (normalized) setAuthUnreachable(false);
      setLoading(false);
    });

    const unsubBetter = auth.getBetterAuthInstance?.()?.useSession?.subscribe?.((value) => {
      // Only apply positive sessions here. Empty payloads fire during boot and
      // would wipe a just-loaded session; signOut clears React state itself.
      if (!value.data?.session || !value.data?.user) return;
      void readUsableSession(auth).then((next) => {
        if (!mounted || !next) return;
        applySession(next);
        setAuthUnreachable(false);
        setLoading(false);
      });
    });

    // The Data API layer found no token mid-use (renewal failed, cookie cleared,
    // session revoked). Ask the server once: if it says signed out, show Login
    // on this same URL instead of a studio where every save fails.
    let checkingLost = false;
    const onAuthLost = () => {
      if (checkingLost || signingOutRef.current) return;
      checkingLost = true;
      void auth
        .getSession({ forceFetch: true })
        .then((res) => {
          const r = res as { data: { session: unknown } | null; error?: unknown };
          if (!mounted || r.error) return; // unreachable ≠ signed out
          if (!normalizeSession(r.data?.session ?? null)) applySession(null);
        })
        .catch(() => {})
        .finally(() => {
          checkingLost = false;
        });
    };
    window.addEventListener(AUTH_LOST_EVENT, onAuthLost);

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      if (typeof unsubBetter === 'function') unsubBetter();
      window.removeEventListener(AUTH_LOST_EVENT, onAuthLost);
    };
  }, [applySession, bootAttempt]);

  // Letter-rise on a real sign-in (skip the first hydrate so refresh stays quiet).
  useEffect(() => {
    if (loading) return;
    const signedIn = Boolean(session?.access_token && session.user.email);
    if (!hydrateDoneRef.current) {
      hydrateDoneRef.current = true;
      wasSignedInRef.current = signedIn;
      return;
    }
    if (signedIn && !wasSignedInRef.current) {
      playUiSound('sign-in');
    }
    wasSignedInRef.current = signedIn;
  }, [loading, session]);

  useEffect(() => {
    if (!session) return;
    const email = session.user.email ?? undefined;
    if (!email) {
      setAuthError(NO_EMAIL_MSG);
      applySession(null);
      void getNeon().auth.signOut().catch(() => {});
    } else {
      setAuthError(null);
    }
  }, [session, applySession]);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!isNeonConfigured()) {
      return { error: 'Neon is not configured.', magicLinkSent: false };
    }
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@') || trimmed.length < 5) {
      return { error: 'Enter a valid email address.', magicLinkSent: false };
    }
    const auth = getNeon().auth as {
      signInWithOtp: (args: unknown) => Promise<{ error: { message?: string } | null }>;
      getBetterAuthInstance?: () => {
        signIn: {
          magicLink: (args: {
            email: string;
            callbackURL?: string;
            newUserCallbackURL?: string;
            errorCallbackURL?: string;
          }) => Promise<{ error?: { message?: string } | null }>;
        };
      };
    };
    const redirectTo = authRedirectUrl();
    const [otp, magic] = await Promise.allSettled([
      auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
      }),
      requestMagicLink(auth, trimmed, redirectTo),
    ]);

    const otpError = friendlyAuthSendError(
      otp.status === 'fulfilled'
        ? (otp.value.error?.message ?? null)
        : otp.reason instanceof Error
          ? otp.reason.message
          : 'Could not send a code.',
    );
    const magicError =
      magic.status === 'fulfilled'
        ? friendlyAuthSendError(magic.value.error?.message ?? null)
        : magic.reason instanceof Error
          ? friendlyAuthSendError(magic.reason.message)
          : 'Could not send a sign-in link.';
    const magicLinkSent = magic.status === 'fulfilled' && !magic.value.error;

    if (otpError && !magicLinkSent) {
      return { error: otpError ?? magicError ?? 'Could not send a sign-in email.', magicLinkSent: false };
    }
    return { error: null, magicLinkSent };
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string) => {
    if (!isNeonConfigured()) {
      return { error: 'Neon is not configured.' };
    }
    const trimmed = email.trim().toLowerCase();
    const code = token.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      return { error: 'Enter the 6-digit code from your email.' };
    }
    const auth = getNeon().auth as SessionClient & {
      verifyOtp: (args: unknown) => Promise<{ error: { message?: string } | null }>;
    };
    try {
      const { error } = await withTimeout(
        auth.verifyOtp({
          email: trimmed,
          token: code,
          type: 'email',
        }),
        VERIFY_TIMEOUT_MS,
        'Sign-in timed out. Request a new code, or use the email link.',
      );
      if (error) return { error: error.message ?? 'That code did not work.' };

      // Same-tab OTP does not fire onAuthStateChange in neon-js — pull the session.
      const next = await readUsableSession(auth);
      if (!next) {
        return {
          error:
            'That code worked, but sign-in did not finish. Try the email link, or request a new code.',
        };
      }
      applySession(next);
      setAuthUnreachable(false);
      setLoading(false);
      return { error: null };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Could not verify that code.',
      };
    }
  }, [applySession]);

  const signInWithGoogle = useCallback(async () => {
    if (!isNeonConfigured()) {
      return { error: 'Neon is not configured.' };
    }
    setAuthError(null);
    const auth = getNeon().auth as {
      signInWithOAuth: (args: unknown) => Promise<{ error: { message?: string } | null }>;
    };
    const { error } = await auth.signInWithOAuth({
      provider: 'google',
      // `queryParams: { prompt: 'select_account' }` was silently dropped by the
      // SDK, so it's gone. Account choice is set on the Google provider in Neon.
      options: { redirectTo: authRedirectUrl() },
    });
    return { error: error?.message ?? null };
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const signOut = useCallback(async (): Promise<{ error: string | null }> => {
    if (!isNeonConfigured()) return { error: null };
    // Only a server-confirmed sign-out counts. Clearing local state first used to
    // "sign out" offline, then the same account came back on focus or reload —
    // the worst case on a shared computer (login check).
    signingOutRef.current = true;
    try {
      const res = (await withTimeout(
        getNeon().auth.signOut() as Promise<{ error?: { message?: string } | null } | undefined>,
        SIGN_OUT_TIMEOUT_MS,
        'timeout',
      )) as { error?: { message?: string } | null } | undefined;
      if (res?.error) throw new Error(res.error.message || 'sign-out failed');
    } catch {
      signingOutRef.current = false;
      return { error: 'Couldn’t sign out — check your connection and try again.' };
    }
    applySession(null);
    setAuthError(null);
    // A full load drops every in-memory cache (forms, responses, file URLs) and
    // lands on Login, whatever page this was.
    window.location.replace('/');
    return { error: null };
  }, [applySession]);

  const retryAuth = useCallback(() => {
    setAuthUnreachable(false);
    setLoading(true);
    setBootAttempt((n) => n + 1);
  }, []);

  const signedIn = Boolean(session?.access_token && session.user.email);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      isPswTeam: signedIn,
      authError,
      signInWithEmail,
      verifyEmailOtp,
      signInWithGoogle,
      signOut,
      clearAuthError,
      authUnreachable,
      retryAuth,
    }),
    [
      loading,
      session,
      signedIn,
      authError,
      signInWithEmail,
      verifyEmailOtp,
      signInWithGoogle,
      signOut,
      clearAuthError,
      authUnreachable,
      retryAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequiresAuth(): { ready: boolean; allowed: boolean } {
  // Hook first, then branch — AuthProvider always wraps the studio.
  const { loading, session, isPswTeam } = useAuth();
  if (!isNeonConfigured()) {
    return { ready: true, allowed: true };
  }
  const hasToken = Boolean(session?.access_token);
  return {
    ready: !loading,
    allowed: Boolean(session && hasToken && isPswTeam),
  };
}
