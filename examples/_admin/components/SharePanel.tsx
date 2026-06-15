/**
 * Slate Share panel — shareable link + QR. Portaled modal; examples/ only.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useFocusTrap } from '../useFocusTrap.js';
import type { Schema } from '@/index.js';
import { copyText } from '../shareUrls.js';
import { buildPortableShareUrl, canEncodePortableSchema } from '../portableShare.js';
import { readSlateMode } from '../slateMode.js';

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
  const shareUrl = canEncodePortableSchema(schema)
    ? buildPortableShareUrl(schema, { formId, name: formName })
    : null;

  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useFocusTrap(panelRef, open, onClose);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !shareUrl) {
      setQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(shareUrl, {
      width: 168,
      margin: 1,
      color: { dark: '#2A2520', light: '#FAF6EE' },
    })
      .then((data) => {
        if (!cancelled) setQr(data);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, shareUrl]);

  const doCopy = useCallback(async () => {
    if (!shareUrl) return;
    const ok = await copyText(shareUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  if (!open || typeof document === 'undefined') return null;

  const mode = readSlateMode();

  return createPortal(
    <div data-slate-forms="" data-theme-name="slate" data-theme={mode}>
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
            <div>
              <h2 id={titleId} className="slate-share-title">
                Share
              </h2>
              <p className="slate-share-sub">{formName}</p>
            </div>
            <button type="button" className="slate-icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <div className="slate-share-body">
            {shareUrl ? (
              <section className="slate-share-block">
                <p className="slate-label" style={{ margin: 0 }}>
                  Shareable Link
                </p>
                <div className="slate-share-row">
                  <input className="slate-input slate-share-url" readOnly value={shareUrl} />
                  <button type="button" className="slate-btn" onClick={() => void doCopy()}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="slate-btn"
                    style={{ textDecoration: 'none' }}
                  >
                    Open
                  </a>
                </div>
                {qr ? (
                  <img src={qr} alt="" className="slate-share-qr" width={168} height={168} />
                ) : (
                  <div className="slate-share-qr slate-share-qr--placeholder" aria-hidden />
                )}
              </section>
            ) : (
              <div className="slate-share-callout">
                <p className="slate-label" style={{ margin: '0 0 4px' }}>
                  Shareable Link
                </p>
                <p className="slate-share-hint" style={{ margin: 0 }}>
                  This form is too large for a shareable link. Remove questions or shorten copy and try again.
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
