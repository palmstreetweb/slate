'use client';

import { useMemo, useState } from 'react';
import { SlateLogo } from '../components/SlateLogo.js';
import { useAuth } from '../supabase/AuthProvider.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';

export function Login() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const mode = readSlateMode();
  const uiTheme = useMemo(() => detectAdminUiTheme(), []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
              Internal form studio — passwordless link sent to your email.
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
              We sent a sign-in link to <strong style={{ color: 'var(--chrome-ink)' }}>{email}</strong>.
              Click it to open the dashboard.
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
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="slate-login-submit"
                disabled={status === 'sending'}
              >
                {status === 'sending' ? 'Sending link…' : 'Send magic link'}
              </button>
            </form>
            {message ? (
              <p className={`slate-login-message slate-login-message--error`} role="alert">
                {message}
              </p>
            ) : null}
            <p className="slate-login-foot">
              PSW team and invited emails only. No password required.
            </p>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
