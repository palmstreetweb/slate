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

type AuthStep = 'send' | 'verify' | 'google';

const AUTH_FALLBACK: Record<AuthStep, string> = {
  send: 'We couldn’t send the sign-in email. Try again in a minute.',
  verify: 'We couldn’t check that code. Try again in a minute.',
  google: 'Google sign-in didn’t start. Try again in a minute.',
};

/**
 * Sign-in failures in plain words (QA COPY-04). Better Auth keeps its own
 * message for codes Neon doesn't map ("Invalid OTP", "OTP expired", "Too many
 * attempts") and the SDK builds "HTTP 500 Internal Server Error", so this
 * maps by message text and status, never by code. Anything it doesn't know
 * gets the step's fallback; the raw error goes to the console.
 */
export function friendlyAuthError(raw: unknown, step: AuthStep): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const e = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const message = (
    typeof raw === 'string' ? raw : typeof e.message === 'string' ? e.message : ''
  ).trim();
  const status = typeof e.status === 'number' ? e.status : undefined;
  console.warn(`[slate] sign-in ${step} failed:`, message || raw);
  if (/invalid callbackurl/i.test(message) || /^HTTP\s*403$/i.test(message)) {
    return 'Sign-in doesn’t work on this address. Go to slateforms.vercel.app and sign in there.';
  }
  if (/invalid otp|invalid code|incorrect code/i.test(message)) {
    return 'That code doesn’t match. Check the newest email and try again.';
  }
  if (/otp expired|code expired|expired otp/i.test(message)) {
    return 'That code has expired. Send a new one.';
  }
  if (/too many attempts/i.test(message)) {
    return 'Too many tries with that code. Send a new one.';
  }
  if (
    raw instanceof TypeError ||
    e.name === 'TypeError' ||
    status === 0 ||
    /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(message)
  ) {
    return 'Can’t reach Slate. Check your connection and try again.';
  }
  if (status === 429 || /too many (email )?requests|rate limit|\b429\b/i.test(message)) {
    return step === 'verify'
      ? 'Too many tries for now. Wait a few minutes, then try again.'
      : 'Too many sign-in emails for now. Wait a few minutes, then try again.';
  }
  if (/invalid email/i.test(message)) return 'Enter a valid email address.';
  return AUTH_FALLBACK[step];
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
const VERIFY_TIMEOUT_MSG = 'Sign-in took too long. Send a new code, or use the email link.';

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
    const message = friendlyAuthError(
      (typeof body?.error === 'object' && body.error?.message) ||
        (typeof body?.error === 'string' && body.error) ||
        body?.message ||
        `HTTP ${res.status}`,
      'send',
    );
    return { error: { message: message ?? AUTH_FALLBACK.send } };
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
      return { error: 'Sign-in isn’t available here.', magicLinkSent: false };
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

    const otpError = friendlyAuthError(
      otp.status === 'fulfilled' ? (otp.value.error ?? null) : (otp.reason ?? 'unknown'),
      'send',
    );
    const magicError =
      magic.status === 'fulfilled'
        ? friendlyAuthError(magic.value.error ?? null, 'send')
        : friendlyAuthError(magic.reason ?? 'unknown', 'send');
    const magicLinkSent = magic.status === 'fulfilled' && !magic.value.error;

    if (otpError && !magicLinkSent) {
      return { error: otpError ?? magicError ?? AUTH_FALLBACK.send, magicLinkSent: false };
    }
    return { error: null, magicLinkSent };
  }, []);

  const verifyEmailOtp = useCallback(async (email: string, token: string) => {
    if (!isNeonConfigured()) {
      return { error: 'Sign-in isn’t available here.' };
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
        VERIFY_TIMEOUT_MSG,
      );
      if (error) return { error: friendlyAuthError(error, 'verify') ?? AUTH_FALLBACK.verify };

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
      if (err instanceof Error && err.message === VERIFY_TIMEOUT_MSG) return { error: err.message };
      return { error: friendlyAuthError(err ?? 'unknown', 'verify') ?? AUTH_FALLBACK.verify };
    }
  }, [applySession]);

  const signInWithGoogle = useCallback(async () => {
    if (!isNeonConfigured()) {
      return { error: 'Sign-in isn’t available here.' };
    }
    setAuthError(null);
    const auth = getNeon().auth as {
      signInWithOAuth: (args: unknown) => Promise<{ error: { message?: string } | null }>;
    };
    try {
      const { error } = await auth.signInWithOAuth({
        provider: 'google',
        // `queryParams: { prompt: 'select_account' }` was silently dropped by the
        // SDK, so it's gone. Account choice is set on the Google provider in Neon.
        options: { redirectTo: authRedirectUrl() },
      });
      return { error: friendlyAuthError(error ?? null, 'google') };
    } catch (err) {
      return { error: friendlyAuthError(err ?? 'unknown', 'google') ?? AUTH_FALLBACK.google };
    }
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
