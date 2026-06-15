/**
 * Slate Share panel — publish link + portable fallback. Portaled modal; examples/ only.
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
  const cloud = isSupabaseConfigured();

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
            {cloud ? (
              <section className="slate-share-block" style={{ marginBottom: 16 }}>
                <p className="slate-label" style={{ margin: '0 0 8px' }}>
                  Production link
                </p>
                {isPublished ? (
                  <p className="slate-share-hint" style={{ margin: '0 0 8px' }}>
                    Published — clients can submit at this URL. Responses sync to Slate cloud.
                  </p>
                ) : (
                  <p className="slate-share-hint" style={{ margin: '0 0 8px' }}>
                    Publish to enable the public fill link. Draft edits are not visible until you publish again.
                  </p>
                )}
                <div className="slate-share-row" style={{ marginBottom: 8 }}>
                  {isPublished ? (
                    <button type="button" className="slate-btn" onClick={onUnpublish} disabled={publishing}>
                      Unpublish
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="slate-btn slate-btn--primary"
                      onClick={onPublish}
                      disabled={publishing}
                    >
                      Publish
                    </button>
                  )}
                </div>
              </section>
            ) : null}

            {shareUrl ? (
              <section className="slate-share-block">
                <p className="slate-label" style={{ margin: 0 }}>
                  {productionUrl ? 'Public fill link' : 'Portable link (demo)'}
                </p>
                <div className="slate-share-row">
                  <input className="slate-input slate-share-url" readOnly value={shareUrl} />
                  <button
                    type="button"
                    className={`slate-btn${copied ? ' slate-btn--copied' : ''}`}
                    onClick={() => void doCopy()}
                  >
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
                  Shareable link
                </p>
                <p className="slate-share-hint" style={{ margin: 0 }}>
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
