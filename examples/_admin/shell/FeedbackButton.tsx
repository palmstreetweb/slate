/**
 * Header feedback — short note from the signed-in studio user.
 */

'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { getNeon } from '../neon/env.js';
import { ensureAuthForDataApi } from '../neon/ensureAuth.js';
import { useAuth } from '../neon/AuthProvider.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';
import { lockBodyScroll } from '../lockBodyScroll.js';
import { useToast } from '../toast.js';

function IconFeedback() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 9.5h6M9 12.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FeedbackButton() {
  const { user } = useAuth();
  const toast = useToast();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  const close = () => {
    if (sending) return;
    setOpen(false);
    setError(null);
  };

  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const auth = await ensureAuthForDataApi();
      const neon = getNeon();
      const { error: insertError } = await neon.from('feedback').insert({
        owner_id: user?.id,
        email: user?.email ?? auth.email,
        message: text,
        path: `${window.location.pathname}${window.location.search}`,
      });
      if (insertError) {
        throw new Error(insertError.message || 'Could not send feedback.');
      }
      setMessage('');
      setOpen(false);
      toast.push({
        title: 'Feedback sent',
        detail: 'Thanks — we got it.',
        tone: 'success',
        sound: 'success',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send feedback.');
    } finally {
      setSending(false);
    }
  };

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  return (
    <>
      <button
        type="button"
        className="slate-btn slate-btn--icon slate-feedback-fab"
        aria-label="Send feedback"
        title="Send feedback"
        data-slate-sound="open"
        onClick={() => setOpen(true)}
      >
        <IconFeedback />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-slate-forms=""
              data-theme-name="slate"
              data-admin-ui={uiTheme}
              data-theme={mode}
            >
              <div className="slate-dialog-backdrop" role="presentation" onClick={close}>
                <div
                  className="slate-dialog slate-feedback"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={titleId}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id={titleId} className="slate-dialog-title">
                    Send feedback
                  </h2>
                  <textarea
                    className="slate-ai-textarea slate-feedback-input"
                    rows={5}
                    value={message}
                    disabled={sending}
                    placeholder="Any feedback would be greatly appreciated, including any bugs."
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <p className="slate-dialog-message">
                    This note goes to Palm Street Web with your email
                    {user?.email ? ` (${user.email})` : ''} and the page you were on.
                  </p>
                  {error ? (
                    <p className="slate-login-message slate-login-message--error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="slate-dialog-actions">
                    <button type="button" className="slate-btn" onClick={close} disabled={sending}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="slate-btn slate-btn--primary"
                      disabled={sending || message.trim().length === 0}
                      onClick={() => void send()}
                    >
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
