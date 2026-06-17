/**
 * Slate Share panel — publish link + portable fallback. Portaled modal; examples/ only.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../useFocusTrap.js';
import type { Schema } from '@/index.js';
import { copyText } from '../shareUrls.js';
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
import { getForm, publishForm, unpublishForm, subscribe } from '../_formsStore.js';
import { isSupabaseConfigured } from '../supabase/env.js';
import { publicFillUrl } from '../supabase/publicApi.js';

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
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrStyle, setQrStyle] = useState<ShareQrStyle>(() => readShareQrStyle());
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    return subscribe(() => setTick((t) => t + 1));
  }, [open]);

  useFocusTrap(panelRef, open, onClose);

  const form = getForm(formId);
  const isPublished = form?.status === 'published';
  const slug = form?.slug ?? formId;

  const productionUrl = isSupabaseConfigured() && isPublished ? publicFillUrl(slug) : null;
  const portableUrl = canEncodePortableSchema(schema)
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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
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
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const onPublish = () => {
    setPublishing(true);
    publishForm(formId);
    setPublishing(false);
  };

  const onUnpublish = () => {
    setPublishing(true);
    unpublishForm(formId);
    setPublishing(false);
  };

  if (!open || typeof document === 'undefined') return null;

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const cloud = isSupabaseConfigured();
  const linkLabel = productionUrl ? 'Public link' : 'Portable link';

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
            <button type="button" className="slate-icon-btn slate-share-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <div className="slate-share-body">
            {cloud ? (
              <section className="slate-share-cloud">
                <p className="slate-share-kicker">Production</p>
                {isPublished ? (
                  <p className="slate-share-hint">
                    Live — responses sync to Slate cloud. Republish after draft edits.
                  </p>
                ) : (
                  <p className="slate-share-hint">
                    Publish to enable the public fill link.
                  </p>
                )}
                <button
                  type="button"
                  className={`slate-btn${isPublished ? '' : ' slate-btn--primary'}`}
                  onClick={isPublished ? onUnpublish : onPublish}
                  disabled={publishing}
                >
                  {isPublished ? 'Unpublish' : 'Publish'}
                </button>
              </section>
            ) : null}

            {shareUrl ? (
              <>
                <section className="slate-share-link-card" aria-label="Share link">
                  <p className="slate-share-kicker">{linkLabel}</p>
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
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="slate-share-open"
                  >
                    Open in browser
                    <span aria-hidden>↗</span>
                  </a>
                </section>

                <section className="slate-share-scan" aria-label="QR code">
                  <div className="slate-share-qr-frame" aria-hidden={!qr}>
                    {qr ? (
                      <img
                        src={qr}
                        alt=""
                        className="slate-share-qr"
                        width={SHARE_QR_DISPLAY_PX}
                        height={SHARE_QR_DISPLAY_PX}
                      />
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

                  <p className="slate-share-scan-hint">Scan with your phone camera</p>
                </section>
              </>
            ) : (
              <div className="slate-share-callout">
                <p className="slate-share-kicker">Shareable link</p>
                <p className="slate-share-hint">
                  {cloud && !isPublished
                    ? 'Publish this form to get a public fill link.'
                    : 'This form is too large for a portable link. Remove questions or shorten copy and try again.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
