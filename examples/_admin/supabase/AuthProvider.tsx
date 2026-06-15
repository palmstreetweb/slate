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

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  isPswTeam: boolean;
};

type AuthContextValue = AuthState & {
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isPswEmail(email: string | undefined): boolean {
  return Boolean(email?.toLowerCase().endsWith('@palmstreetweb.com'));
}

async function canSignIn(email: string): Promise<boolean> {
  if (isPswEmail(email)) return true;
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('can_sign_in', { p_email: email.trim().toLowerCase() });
  if (error) return false;
  return Boolean(data);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isSupabaseConfigured());
  const [session, setSession] = useState<Session | null>(null);
  const [isTeam, setIsTeam] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const supabase = getSupabase();
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
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
    if (!session?.user?.email) {
      setIsTeam(false);
      return;
    }
    let mounted = true;
    void canSignIn(session.user.email).then((ok) => {
      if (mounted) setIsTeam(ok);
    });
    return () => {
      mounted = false;
    };
  }, [session]);

  const signInWithEmail = useCallback(async (email: string) => {
    if (!isSupabaseConfigured()) {
      return { error: 'Supabase is not configured.' };
    }
    const trimmed = email.trim().toLowerCase();
    const allowed = await canSignIn(trimmed);
    if (!allowed) {
      return { error: 'This email is not authorized for Slate. Ask a PSW admin to add you.' };
    }
    const supabase = getSupabase();
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo },
    });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    await getSupabase().auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      isPswTeam: isTeam,
      signInWithEmail,
      signOut,
    }),
    [loading, session, isTeam, signInWithEmail, signOut],
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
