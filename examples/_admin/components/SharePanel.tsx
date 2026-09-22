/**
 * Slate Share panel — publish link + portable fallback. Portaled modal; examples/ only.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../useFocusTrap.js';
import type { Schema } from '@/index.js';
import { copyText, copyImage } from '../shareUrls.js';
import { buildPortableShareUrl, canEncodePortableSchema } from '../portableShare.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';
import {
  readShareQrStyle,
  renderShareQr,
  SHARE_QR_DISPLAY_PX,
  SHARE_QR_STYLES,
  writeShareQrStyle,
  type ShareQrStyle,
} from '../shareQr.js';
import {
  getForm,
  publishForm,
  unpublishForm,
  subscribe,
  hasUnpublishedChanges,
  setFormFillPassword,
} from '../_formsStore.js';
import { isNeonConfigured } from '../neon/env.js';
import { publicFillUrl } from '../neon/publicApi.js';
import { playUiSound } from '../uiSounds.js';
import { useToast } from '../toast.js';
import { lockBodyScroll } from '../lockBodyScroll.js';

type Props = {
  open: boolean;
  onClose: () => void;
  formId: string;
  formName: string;
  schema: Schema;
};

export function SharePanel({ open, onClose, formId, formName, schema }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrStyle, setQrStyle] = useState<ShareQrStyle>(() => readShareQrStyle());
  const [copied, setCopied] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [lockEditing, setLockEditing] = useState(false);
  const [lockDraft, setLockDraft] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (open) return;
    // Never keep a typed password around after the sheet closes.
    setLockEditing(false);
    setLockDraft('');
    setLockError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return subscribe(() => setTick((t) => t + 1));
  }, [open]);

  useFocusTrap(panelRef, open, onClose);

  const form = getForm(formId);
  const isPublished = form?.status === 'published';
  const stale = hasUnpublishedChanges(form);
  const slug = form?.slug ?? formId;

  const productionUrl = isNeonConfigured() && isPublished ? publicFillUrl(slug) : null;
  // A portable link carries the whole schema in the URL — it would walk straight
  // past the password (ADR-043). Locked forms only share the real public link.
  const portableUrl =
    !form?.fillLocked && canEncodePortableSchema(schema)
      ? buildPortableShareUrl(schema, { formId, name: formName })
      : null;
  const shareUrl = productionUrl ?? portableUrl;

  /**
   * The QR encodes a SHORT link so the code stays chunky and scannable.
   * The full portable link (which embeds the whole schema) lives in the copy
   * field instead — packing ~2KB into a QR forces a tiny, dense grid.
   */
  const shortFormUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#/forms/${formId}`
      : `#/forms/${formId}`;
  const qrUrl = productionUrl ?? shortFormUrl;

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  useEffect(() => {
    if (!open || !qrUrl) {
      setQr(null);
      setQrError(null);
      return;
    }
    let cancelled = false;
    void renderShareQr(qrUrl, qrStyle)
      .then((data) => {
        if (!cancelled) {
          setQr(data);
          setQrError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setQr(null);
          setQrError(err instanceof Error ? err.message : 'Could not render QR code');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, qrUrl, qrStyle]);

  const onQrStyleChange = useCallback((style: ShareQrStyle) => {
    setQrStyle(style);
    writeShareQrStyle(style);
  }, []);

  const doCopy = useCallback(async () => {
    if (!shareUrl) return;
    const ok = await copyText(shareUrl);
    if (ok) {
      playUiSound('copy');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const onCopyQr = useCallback(async () => {
    if (!qr) return;
    const ok = await copyImage(qr);
    if (ok) {
      playUiSound('copy');
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 2000);
    }
  }, [qr]);

  const onPublish = () => {
    setPublishing(true);
    const next = publishForm(formId);
    setPublishing(false);
    if (next) {
      toast.push({
        title: stale ? 'Republished' : 'You’re live',
        detail: 'Public link is serving this draft.',
        tone: 'success',
        sound: 'success',
      });
    } else {
      toast.push({
        title: 'Could not publish',
        detail: 'Check your connection and try again.',
        tone: 'error',
      });
    }
  };

  const onUnpublish = () => {
    setPublishing(true);
    const next = unpublishForm(formId);
    setPublishing(false);
    if (next) {
      toast.push({
        title: 'Unpublished',
        detail: 'Public fill link is off. Draft stays in your library.',
        tone: 'info',
        sound: 'tap',
      });
    }
  };

  const fillLocked = Boolean(form?.fillLocked);

  const applyLock = async (password: string) => {
    if (lockBusy) return;
    if (password && (password.length < 4 || password.length > 72)) {
      setLockError('Use 4 to 72 characters.');
      return;
    }
    setLockBusy(true);
    setLockError(null);
    const result = await setFormFillPassword(formId, password);
    setLockBusy(false);
    if (!result.ok) {
      setLockError(result.message);
      return;
    }
    setLockEditing(false);
    setLockDraft('');
    toast.push(
      result.locked
        ? {
            title: fillLocked ? 'Password changed' : 'Password on',
            detail: 'Same link and QR. People enter it once per visit.',
            tone: 'success',
            sound: 'success',
          }
        : {
            title: 'Password off',
            detail: 'Anyone with the link can fill it in again.',
            tone: 'info',
            sound: 'tap',
          },
    );
  };

  if (!open || typeof document === 'undefined') return null;

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const cloud = isNeonConfigured();

  const lockRow = cloud ? (
    <section className="slate-share-lock" aria-label="Password">
      {lockEditing ? (
        <form
          className="slate-share-lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            void applyLock(lockDraft.trim());
          }}
        >
          <input
            className="slate-input slate-share-lock-input"
            type="text"
            value={lockDraft}
            onChange={(e) => {
              setLockDraft(e.target.value);
              setLockError(null);
            }}
            placeholder={fillLocked ? 'New word or PIN' : 'Word or PIN'}
            aria-label="Form password"
            aria-invalid={lockError ? true : undefined}
            minLength={4}
            maxLength={72}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            autoFocus
          />
          <button
            type="submit"
            className="slate-btn slate-btn--primary slate-btn--compact"
            disabled={lockBusy || lockDraft.trim().length < 4}
          >
            {lockBusy ? 'Saving…' : 'Set'}
          </button>
          <button
            type="button"
            className="slate-share-lock-link"
            onClick={() => {
              setLockEditing(false);
              setLockDraft('');
              setLockError(null);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="slate-share-lock-row">
          <span className="slate-share-lock-label">
            <LockGlyph />
            {fillLocked ? 'Locked' : 'Password'}
          </span>
          {fillLocked ? (
            <span className="slate-share-lock-actions">
              <button
                type="button"
                className="slate-share-lock-link"
                onClick={() => setLockEditing(true)}
                disabled={lockBusy}
              >
                Change
              </button>
              <button
                type="button"
                className="slate-share-lock-link"
                onClick={() => void applyLock('')}
                disabled={lockBusy}
              >
                {lockBusy ? 'Removing…' : 'Remove'}
              </button>
            </span>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={false}
              aria-label="Require a password to fill this form"
              className="slate-share-lock-switch"
              onClick={() => setLockEditing(true)}
            >
              <span aria-hidden />
            </button>
          )}
        </div>
      )}
      {lockError ? (
        <p className="slate-share-lock-error" role="alert">
          {lockError}
        </p>
      ) : null}
    </section>
  ) : null;

  return createPortal(
    <div data-slate-forms="" data-theme-name="slate" data-admin-ui={uiTheme} data-theme={mode}>
      <div
        className="slate-dialog-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={panelRef}
          className="slate-share-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="slate-share-header">
            <div className="slate-share-header-text">
              <h2 id={titleId} className="slate-share-title">
                Share
              </h2>
              <p className="slate-share-sub">{formName}</p>
            </div>
            <button
              type="button"
              className="slate-icon-btn slate-share-close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          <div className="slate-share-body">
            {shareUrl ? (
              <>
                <section className="slate-share-link-card" aria-label="Share link">
                  <div className="slate-share-link-field">
                    <input
                      className="slate-input slate-share-url"
                      readOnly
                      value={shareUrl}
                      aria-label="Share URL"
                    />
                    <button
                      type="button"
                      className={`slate-share-copy${copied ? ' slate-share-copy--done' : ''}`}
                      onClick={() => void doCopy()}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="slate-share-actions">
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="slate-share-open"
                    >
                      Open in browser
                      <span aria-hidden>↗</span>
                    </a>
                    {cloud ? (
                      <button
                        type="button"
                        className={`slate-btn slate-btn--compact${isPublished && !stale ? '' : ' slate-btn--primary'}`}
                        onClick={isPublished && !stale ? onUnpublish : onPublish}
                        disabled={publishing}
                      >
                        {publishing
                          ? 'Working…'
                          : isPublished
                            ? stale
                              ? 'Republish'
                              : 'Unpublish'
                            : 'Publish'}
                      </button>
                    ) : null}
                  </div>
                </section>

                {lockRow}

                <section className="slate-share-scan" aria-label="QR code">
                  <div className="slate-share-qr-frame" aria-hidden={!qr}>
                    {qr ? (
                      <button
                        type="button"
                        className="slate-share-qr-btn"
                        onClick={() => void onCopyQr()}
                        title="Click to copy QR image"
                        aria-label={qrCopied ? 'QR code copied' : 'Copy QR code image'}
                      >
                        <img
                          src={qr}
                          alt=""
                          className="slate-share-qr"
                          width={SHARE_QR_DISPLAY_PX}
                          height={SHARE_QR_DISPLAY_PX}
                        />
                        {qrCopied ? <span className="slate-share-qr-toast">Copied</span> : null}
                      </button>
                    ) : qrError ? (
                      <div className="slate-share-qr slate-share-qr--error" role="status">
                        {qrError}
                      </div>
                    ) : (
                      <div className="slate-share-qr slate-share-qr--placeholder" />
                    )}
                  </div>

                  <div className="slate-share-style-pills" role="tablist" aria-label="QR style">
                    {SHARE_QR_STYLES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={qrStyle === option.id}
                        title={option.description}
                        className={`slate-share-style-pill${
                          qrStyle === option.id ? ' slate-share-style-pill--active' : ''
                        }`}
                        onClick={() => onQrStyleChange(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </section>

                <div className="slate-share-foot">
                  {isPublished && !stale ? (
                    <p className="slate-share-live">
                      <span className="slate-share-live-dot" aria-hidden />
                      Live
                    </p>
                  ) : stale ? (
                    <p className="slate-share-stale" role="status">
                      Unpublished changes
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="slate-share-callout">
                  <p className="slate-share-kicker">Shareable link</p>
                  <p className="slate-share-hint">
                    {cloud && !isPublished
                      ? 'Publish this form to get a public fill link.'
                      : 'This form is too large for a portable link. Remove questions or shorten copy and try again.'}
                  </p>
                  {cloud ? (
                    <button
                      type="button"
                      className="slate-btn slate-btn--primary slate-btn--compact"
                      onClick={onPublish}
                      disabled={publishing}
                    >
                      {publishing ? 'Working…' : 'Publish'}
                    </button>
                  ) : null}
                </div>
                {lockRow}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
