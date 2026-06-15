'use client';

import { useMemo, useState } from 'react';
import { SlateLogo } from '../components/SlateLogo.js';
import { useAuth } from '../supabase/AuthProvider.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.083 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C33.64 6.053 29.082 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C33.64 6.053 29.082 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export function Login() {
  const { signInWithEmail, signInWithGoogle, authError, clearAuthError } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'google'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const mode = readSlateMode();
  const uiTheme = useMemo(() => detectAdminUiTheme(), []);

  const displayError = message ?? authError;

  const onGoogle = async () => {
    clearAuthError();
    setMessage(null);
    setStatus('google');
    const { error } = await signInWithGoogle();
    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }
    setStatus('idle');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setStatus('sending');
    setMessage(null);
    const { error } = await signInWithEmail(email);
    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }
    setStatus('sent');
    setMessage(null);
  };

  return (
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-theme={mode}
      data-admin-ui={uiTheme}
    >
      <div className="slate-app slate-login">
        <div className="slate-login-card">
          <div className="slate-login-brand">
            <SlateLogo variant="lockup" height={32} aria-label="Slate" role="img" />
            <div>
              <h1 className="slate-login-title">Sign in to Slate</h1>
              <p className="slate-login-lead">
                Internal form studio for the PSW team and invited collaborators.
              </p>
            </div>
          </div>

          {status === 'sent' ? (
            <div className="slate-login-sent">
              <div className="slate-login-sent-icon" aria-hidden>
                ✓
              </div>
              <h2 className="slate-login-title" style={{ fontSize: 'var(--slate-fs-lg)' }}>
                Check your inbox
              </h2>
              <p className="slate-login-lead" style={{ marginTop: 8 }}>
                We sent a sign-in link to{' '}
                <strong style={{ color: 'var(--chrome-ink)' }}>{email}</strong>. Click it to open
                the dashboard.
              </p>
              <button
                type="button"
                className="slate-login-back"
                onClick={() => {
                  setStatus('idle');
                  setEmail('');
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="slate-login-google"
                onClick={() => void onGoogle()}
                disabled={status === 'google' || status === 'sending'}
              >
                <GoogleIcon />
                {status === 'google' ? 'Redirecting to Google…' : 'Continue with Google'}
              </button>

              <div className="slate-login-divider" aria-hidden>
                <span>or</span>
              </div>

              <form className="slate-login-form" onSubmit={(e) => void onSubmit(e)}>
                <div className="slate-login-field">
                  <label className="slate-label" htmlFor="login-email">
                    Work email
                  </label>
                  <input
                    id="login-email"
                    className="slate-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@palmstreetweb.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="slate-login-submit slate-login-submit--secondary"
                  disabled={status === 'sending' || status === 'google'}
                >
                  {status === 'sending' ? 'Sending link…' : 'Send magic link'}
                </button>
              </form>
              {displayError ? (
                <p className="slate-login-message slate-login-message--error" role="alert">
                  {displayError}
                </p>
              ) : null}
              <p className="slate-login-foot">
                Google Workspace or allowlisted email only. Magic link is a fallback if you prefer.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
