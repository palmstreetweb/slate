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
  signOut: () => Promise<void>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Neon Auth only accepts allowlisted callback origins (prod today). */
const AUTH_CALLBACK_FALLBACK = 'https://slateforms.vercel.app';

function authRedirectUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname, hash } = window.location;
  const safeHash =
    hash && hash !== '#' && !hash.includes('access_token=') ? hash : '#/';
  let base = origin;
  try {
    const host = new URL(origin).hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (loopback) {
      // Local origins are usually not on Neon’s trusted list → HTTP 403
      // "Invalid callbackURL". Send magic links to prod; OTP still works here.
      const configured = import.meta.env.VITE_AUTH_CALLBACK_ORIGIN?.trim().replace(/\/$/, '');
      base = configured || AUTH_CALLBACK_FALLBACK;
    }
  } catch {
    /* keep window origin */
  }
  return `${base}${pathname || '/'}${safeHash}`;
}

function friendlyAuthSendError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/invalid callbackurl/i.test(t) || /^HTTP\s*403$/i.test(t)) {
    return 'Could not send a sign-in email from this origin. Open slateforms.vercel.app to sign in, or add this URL under Neon Auth → Trusted origins.';
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
  const hydrateDoneRef = useRef(false);
  const wasSignedInRef = useRef(false);

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

    void auth
      .getSession()
      .then((res) => {
        if (!mounted) return;
        setSession(normalizeSession(res.data?.session ?? null));
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const { data: sub } = auth.onAuthStateChange((_event, next) => {
      // Neon’s adapter only emits this for the first subscribe + other tabs.
      // A successful same-tab OTP still needs getSession() in verifyEmailOtp.
      if (!mounted) return;
      setSession(normalizeSession(next));
      setLoading(false);
    });

    const unsubBetter = auth.getBetterAuthInstance?.()?.useSession?.subscribe?.((value) => {
      // Only apply positive sessions here. Empty payloads fire during boot and
      // would wipe a just-loaded session; signOut clears React state itself.
      if (!value.data?.session || !value.data?.user) return;
      void readUsableSession(auth).then((next) => {
        if (!mounted || !next) return;
        setSession(next);
        setLoading(false);
      });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      if (typeof unsubBetter === 'function') unsubBetter();
    };
  }, []);

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
      clearRemoteStores();
      setSession(null);
      void getNeon().auth.signOut().catch(() => {});
    } else {
      setAuthError(null);
    }
  }, [session]);

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
      setSession(next);
      setLoading(false);
      return { error: null };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Could not verify that code.',
      };
    }
  }, []);

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
      options: {
        redirectTo: authRedirectUrl(),
        queryParams: { prompt: 'select_account' },
      },
    });
    return { error: error?.message ?? null };
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const signOut = useCallback(async () => {
    if (!isNeonConfigured()) return;
    // Same-tab sign-out often skips onAuthStateChange (same as OTP). Clear
    // React state up front so the gate flips to Login immediately.
    clearRemoteStores();
    setSession(null);
    setAuthError(null);
    setLoading(false);
    try {
      await getNeon().auth.signOut();
    } catch {
      // Local session already cleared — stay signed out even if the network call fails.
    }
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
  if (!isNeonConfigured()) {
    return { ready: true, allowed: true };
  }
  const { loading, session, isPswTeam } = useAuth();
  const hasToken = Boolean(session?.access_token);
  return {
    ready: !loading,
    allowed: Boolean(session && hasToken && isPswTeam),
  };
}
