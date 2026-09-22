'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SlateLogo } from '../components/SlateLogo.js';
import { routeSearchParams } from '../_router.js';
import { useAuth } from '../neon/AuthProvider.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';

function readOtpFromUrl(): string {
  const raw = routeSearchParams().get('otp') || routeSearchParams().get('code') || '';
  return raw.replace(/\D/g, '').slice(0, 6);
}

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

function LoginOtpField({
  id,
  value,
  disabled,
  inputRef,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (next: string) => void;
}) {
  const digits = value.replace(/\D/g, '').slice(0, 6);
  const active = digits.length === 6 ? 5 : digits.length;

  return (
    <div className="slate-login-otp">
      <input
        ref={inputRef}
        id={id}
        className="slate-login-otp-trap"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
        pattern="[0-9]*"
        maxLength={6}
        value={digits}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
        aria-label="Sign-in code"
      />
      <div className="slate-login-otp-bar" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`slate-login-otp-cell${i === active ? ' is-active' : ''}${i === 5 ? ' is-last' : ''}`}
          >
            {digits[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Login() {
  const { signInWithEmail, verifyEmailOtp, signInWithGoogle, authError, clearAuthError } =
    useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'sending' | 'sent' | 'verifying' | 'error' | 'google'
  >('idle');
  const [magicLinkSent, setMagicLinkSent] = useState(true);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const verifyingRef = useRef(false);
  const seededCode = useMemo(() => readOtpFromUrl(), []);
  const mode = readSlateMode();
  const uiTheme = useMemo(() => detectAdminUiTheme(), []);

  const displayError = message ?? authError;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('error');
    if (!raw) return;
    const friendly =
      raw === 'INVALID_TOKEN'
        ? 'That sign-in link expired or was already used. Request a new one.'
        : 'Sign-in did not finish. Request a new link or code and try again.';
    setStatus('error');
    setMessage(friendly);
    params.delete('error');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.replaceState({}, '', next);
  }, []);

  useEffect(() => {
    if (status !== 'sent') return;
    codeRef.current?.focus();
  }, [status]);

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
    const { error, magicLinkSent: sentLink } = await signInWithEmail(email);
    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }
    setMagicLinkSent(sentLink);
    setCode('');
    setStatus('sent');
    setMessage(null);
  };

  const submitCode = async (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, 6);
    setCode(next);
    if (next.length !== 6 || verifyingRef.current) return;
    verifyingRef.current = true;
    clearAuthError();
    setStatus('verifying');
    setMessage(null);
    try {
      const { error } = await verifyEmailOtp(email, next);
      if (error) {
        setStatus('sent');
        setMessage(error);
        setCode('');
        codeRef.current?.focus();
      }
    } catch (err) {
      setStatus('sent');
      setMessage(err instanceof Error ? err.message : 'Could not verify that code.');
      setCode('');
      codeRef.current?.focus();
    } finally {
      verifyingRef.current = false;
    }
  };

  const seededUsedRef = useRef(false);
  useEffect(() => {
    if (status !== 'sent' || seededCode.length !== 6 || seededUsedRef.current) return;
    seededUsedRef.current = true;
    void submitCode(seededCode);
  }, [status, seededCode]);

  const onResend = async () => {
    if (resending || status === 'verifying') return;
    clearAuthError();
    setResending(true);
    setMessage(null);
    const { error, magicLinkSent: sentLink } = await signInWithEmail(email);
    setResending(false);
    if (error) {
      setMessage(error);
      return;
    }
    setMagicLinkSent(sentLink);
    setCode('');
    setMessage(null);
    codeRef.current?.focus();
  };

  return (
    <div data-slate-forms="" data-theme-name="slate" data-theme={mode} data-admin-ui={uiTheme}>
      <div className="slate-app slate-login">
        <div className="slate-login-card">
          <div className="slate-login-brand">
            <SlateLogo variant="lockup" height={32} aria-label="Slate" role="img" />
            <div>
              <h1 className="slate-login-title">Sign in to Slate</h1>
              <p className="slate-login-lead">
                Create and share conversational forms. Sign in to open your studio.
              </p>
            </div>
          </div>

          {status === 'sent' || status === 'verifying' ? (
            <div className="slate-login-sent">
              <h2 className="slate-login-title" style={{ fontSize: 'var(--slate-fs-lg)' }}>
                Check your inbox
              </h2>
              <p className="slate-login-lead" style={{ marginTop: 8 }}>
                {magicLinkSent ? (
                  <>
                    We emailed a sign-in link and a 6-digit code to{' '}
                    <strong style={{ color: 'var(--chrome-ink)' }}>{email}</strong>. Click the link,
                    or type the code below.
                  </>
                ) : (
                  <>
                    We emailed a 6-digit code to{' '}
                    <strong style={{ color: 'var(--chrome-ink)' }}>{email}</strong>.
                  </>
                )}
              </p>
              <form
                className="slate-login-form"
                style={{ marginTop: 18 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitCode(code);
                }}
              >
                <div className="slate-login-field">
                  <label className="slate-label" htmlFor="login-code">
                    Sign-in code
                  </label>
                  <LoginOtpField
                    id="login-code"
                    value={code}
                    disabled={status === 'verifying'}
                    inputRef={codeRef}
                    onChange={(next) => void submitCode(next)}
                  />
                </div>
                <button
                  type="submit"
                  className="slate-login-submit slate-login-submit--secondary"
                  disabled={status === 'verifying' || code.length !== 6}
                >
                  {status === 'verifying' ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              {displayError ? (
                <p className="slate-login-message slate-login-message--error" role="alert">
                  {displayError}
                </p>
              ) : null}
              <div className="slate-login-sent-actions">
                <button
                  type="button"
                  className="slate-login-back"
                  onClick={() => void onResend()}
                  disabled={status === 'verifying' || resending}
                >
                  {resending ? 'Sending…' : 'Resend email'}
                </button>
                <button
                  type="button"
                  className="slate-login-back"
                  onClick={() => {
                    setStatus('idle');
                    setCode('');
                    setMessage(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
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
                    Email
                  </label>
                  <input
                    id="login-email"
                    className="slate-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {seededCode.length === 6 ? (
                  <div className="slate-login-seeded">
                    <p className="slate-login-foot" style={{ margin: 0 }}>
                      Sign-in code from your email is ready. Enter your address, then we’ll use it.
                    </p>
                    <button
                      type="button"
                      className="slate-login-back"
                      data-slate-sound="copy"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(seededCode)
                          .then(() => {
                            setCopiedCode(true);
                            window.setTimeout(() => setCopiedCode(false), 1600);
                          })
                          .catch(() => {});
                      }}
                    >
                      {copiedCode ? 'Copied' : 'Copy code'}
                    </button>
                  </div>
                ) : null}
                <button
                  type="submit"
                  className="slate-login-submit slate-login-submit--secondary"
                  disabled={status === 'sending' || status === 'google'}
                >
                  {status === 'sending' ? 'Sending…' : 'Email me a link and code'}
                </button>
              </form>
              {displayError ? (
                <p className="slate-login-message slate-login-message--error" role="alert">
                  {displayError}
                </p>
              ) : null}
              <p className="slate-login-foot">
                Anyone can sign up. Google is one click. Email sends a sign-in link and a 6-digit
                code — use either.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
