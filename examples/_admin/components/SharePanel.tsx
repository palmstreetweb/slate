/**
 * Slate Share panel — public link + QR (when configured) and a dev
 * preview link for local testing. Portaled modal; lives in examples/ only.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useFocusTrap } from '../useFocusTrap.js';
import type { Schema } from '@/index.js';
import {
  buildDevPreviewUrl,
  buildPublicShareUrl,
  copyText,
  getPublicFormBase,
  resolveFormSlug,
  slugify,
} from '../shareUrls.js';
import {
  buildPortableShareUrl,
  canEncodePortableSchema,
} from '../portableShare.js';
import { readSlateMode } from '../slateMode.js';

type Props = {
  open: boolean;
  onClose: () => void;
  formId: string;
  formName: string;
  slug: string;
  schema: Schema;
  onSlugChange: (slug: string) => void;
};

export function SharePanel({
  open,
  onClose,
  formId,
  formName,
  slug,
  schema,
  onSlugChange,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const publicBase = getPublicFormBase();
  const effectiveSlug = resolveFormSlug({ slug, name: formName, id: formId });
  const publicUrl = buildPublicShareUrl(effectiveSlug);
  const previewUrl = buildDevPreviewUrl(formId);
  const portableUrl = canEncodePortableSchema(schema)
    ? buildPortableShareUrl(schema, { formId, name: formName })
    : null;

  const [publicQr, setPublicQr] = useState<string | null>(null);
  const [previewQr, setPreviewQr] = useState<string | null>(null);
  const [portableQr, setPortableQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'public' | 'preview' | 'portable' | null>(null);

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
    if (!open || !publicUrl) {
      setPublicQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(publicUrl, {
      width: 168,
      margin: 1,
      color: { dark: '#2A2520', light: '#FAF6EE' },
    })
      .then((data) => {
        if (!cancelled) setPublicQr(data);
      })
      .catch(() => {
        if (!cancelled) setPublicQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, publicUrl]);

  useEffect(() => {
    if (!open) {
      setPreviewQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(previewUrl, {
      width: 168,
      margin: 1,
      color: { dark: '#2A2520', light: '#FAF6EE' },
    })
      .then((data) => {
        if (!cancelled) setPreviewQr(data);
      })
      .catch(() => {
        if (!cancelled) setPreviewQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, previewUrl]);

  useEffect(() => {
    if (!open || !portableUrl) {
      setPortableQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(portableUrl, {
      width: 168,
      margin: 1,
      color: { dark: '#2A2520', light: '#FAF6EE' },
    })
      .then((data) => {
        if (!cancelled) setPortableQr(data);
      })
      .catch(() => {
        if (!cancelled) setPortableQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, portableUrl]);

  const doCopy = useCallback(async (which: 'public' | 'preview' | 'portable', text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    }
  }, []);

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
            <label className="slate-share-field">
              <span className="slate-label">URL Slug</span>
              <div className="slate-share-slug-row">
                {publicBase ? (
                  <span className="slate-share-slug-prefix">{publicBase}/</span>
                ) : null}
                <input
                  className="slate-input"
                  value={slug}
                  onChange={(e) => onSlugChange(slugify(e.target.value))}
                  placeholder={slugify(formName)}
                  spellCheck={false}
                />
              </div>
            </label>

            {portableUrl ? (
              <ShareBlock
                title="Shareable Link"
                hint="Send this to respondents — works on any device. Responses show under Responses on this browser."
                url={portableUrl}
                qr={portableQr}
                copied={copied === 'portable'}
                onCopy={() => void doCopy('portable', portableUrl)}
              />
            ) : (
              <div className="slate-share-callout">
                <p className="slate-label" style={{ margin: '0 0 4px' }}>
                  Shareable Link
                </p>
                <p className="slate-share-hint" style={{ margin: 0 }}>
                  This form is too large for a portable link. Shorten the form or use a client embed URL.
                </p>
              </div>
            )}

            {publicUrl ? (
              <ShareBlock
                title="Public Link"
                url={publicUrl}
                qr={publicQr}
                copied={copied === 'public'}
                onCopy={() => void doCopy('public', publicUrl)}
              />
            ) : (
              <div className="slate-share-callout">
                <p className="slate-label" style={{ margin: '0 0 4px' }}>
                  Public Link
                </p>
                <p className="slate-share-hint" style={{ margin: 0 }}>
                  Set <code className="slate-share-code">VITE_PUBLIC_FORM_BASE</code> in{' '}
                  <code className="slate-share-code">.env.local</code> for a client-site embed URL.
                </p>
              </div>
            )}

            <ShareBlock
              title="Dev Preview"
              hint="This device only — reads from localStorage on this browser."
              url={previewUrl}
              qr={previewQr}
              copied={copied === 'preview'}
              onCopy={() => void doCopy('preview', previewUrl)}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ShareBlock({
  title,
  hint,
  url,
  qr,
  copied,
  onCopy,
}: {
  title: string;
  hint?: string;
  url: string;
  qr: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="slate-share-block">
      <p className="slate-label" style={{ margin: 0 }}>
        {title}
      </p>
      {hint ? (
        <p className="slate-share-hint" style={{ margin: '4px 0 10px' }}>
          {hint}
        </p>
      ) : null}
      <div className="slate-share-row">
        <input className="slate-input slate-share-url" readOnly value={url} />
        <button type="button" className="slate-btn" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={url}
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
  );
}
