'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './env.js';
import { clearRemoteStores } from './hydrate.js';

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  isPswTeam: boolean;
};

type AuthContextValue = AuthState & {
  authError: string | null;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isPswEmail(email: string | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith('@palmstreetweb.com'));
}

type CanSignInResult =
  | { status: 'allowed' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

async function checkCanSignIn(email: string): Promise<CanSignInResult> {
  if (isPswEmail(email)) return { status: 'allowed' };
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('can_sign_in', {
    p_email: email.trim().toLowerCase(),
  });
  if (error) {
    return {
      status: 'error',
      message: 'Could not verify access. Check your connection and try again.',
    };
  }
  return data ? { status: 'allowed' } : { status: 'denied' };
}

function authRedirectUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const { origin, pathname, hash } = window.location;
  const safeHash =
    hash && hash !== '#' && !hash.includes('access_token=') ? hash : '#/';
  return `${origin}${pathname || '/'}${safeHash}`;
}

const UNAUTHORIZED_MSG =
  'This email is not authorized for Slate. Ask a PSW admin to add you.';

const NO_EMAIL_MSG =
  'This sign-in has no email address. Use Google Workspace or a magic link instead.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured());
  const [checkingTeam, setCheckingTeam] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isTeam, setIsTeam] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const supabase = getSupabase();
    let mounted = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setIsTeam(false);
      return;
    }

    const email = session.user.email;
    if (!email) {
      setIsTeam(false);
      setAuthError(NO_EMAIL_MSG);
      void getSupabase().auth.signOut();
      return;
    }

    let mounted = true;
    setIsTeam(false);
    setCheckingTeam(true);
    void checkCanSignIn(email)
      .then(async (result) => {
        if (!mounted) return;
        if (result.status === 'error') {
          setAuthError(result.message);
          return;
        }
        if (result.status === 'denied') {
          setAuthError(UNAUTHORIZED_MSG);
          clearRemoteStores();
          await getSupabase().auth.signOut();
          return;
        }
        setAuthError(null);
        setIsTeam(true);
      })
      .finally(() => {
        if (mounted) setCheckingTeam(false);
      });
    return () => {
      mounted = false;
      setCheckingTeam(false);
    };
  }, [session]);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!isSupabaseConfigured()) {
      return { error: 'Supabase is not configured.' };
    }
    const trimmed = email.trim().toLowerCase();
    const result = await checkCanSignIn(trimmed);
    if (result.status === 'error') return { error: result.message };
    if (result.status === 'denied') return { error: UNAUTHORIZED_MSG };
    const supabase = getSupabase();
    const redirectTo = authRedirectUrl();
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo },
    });
    return { error: error?.message ?? null };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      return { error: 'Supabase is not configured.' };
    }
    setAuthError(null);
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
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
    if (!isSupabaseConfigured()) return;
    setIsTeam(false);
    clearRemoteStores();
    await getSupabase().auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading: loading || checkingTeam,
      session,
      user: session?.user ?? null,
      isPswTeam: isTeam,
      authError,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      clearAuthError,
    }),
    [loading, checkingTeam, session, isTeam, authError, signInWithEmail, signInWithGoogle, signOut, clearAuthError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequiresAuth(): { ready: boolean; allowed: boolean } {
  if (!isSupabaseConfigured()) {
    return { ready: true, allowed: true };
  }
  const { loading, session, isPswTeam } = useAuth();
  return {
    ready: !loading,
    allowed: Boolean(session && isPswTeam),
  };
}
