'use client';

import { useState } from 'react';
import { useAuth } from '../supabase/AuthProvider.js';
import { readSlateMode } from '../slateMode.js';

export function Login() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const mode = readSlateMode();

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
    setMessage('Check your inbox for a sign-in link.');
  };

  return (
    <div data-slate-forms="" data-theme-name="slate" data-theme={mode} className="slate-app">
      <div
        className="slate-empty"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ width: 'min(400px, 100%)' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 600 }}>Slate</h1>
          <p style={{ margin: '0 0 24px', color: 'var(--slate-muted)', fontSize: 14 }}>
            Palm Street Web team sign in
          </p>
          <form onSubmit={(e) => void onSubmit(e)}>
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
              style={{ width: '100%', marginBottom: 12 }}
            />
            <button
              type="submit"
              className="slate-btn slate-btn--primary"
              disabled={status === 'sending'}
              style={{ width: '100%' }}
            >
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
          {message ? (
            <p
              style={{
                margin: '16px 0 0',
                fontSize: 13,
                color: status === 'error' ? 'var(--slate-error)' : 'var(--slate-muted)',
              }}
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
