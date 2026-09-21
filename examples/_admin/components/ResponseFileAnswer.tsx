/**
 * Renders file_upload answers in the Responses inbox with preview + download.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  formatBytes,
  isFileUploadRef,
  type FileUploadMeta,
} from '@/utils/fileUploadRef.js';
import { convertHeicToJpegFile } from '@/utils/heicToJpeg.js';
import { getLocalUploadBlob } from '../localFileStore.js';
import { resolveUploadMeta } from '../resolveUploadMeta.js';
import {
  getStorageContentBlob,
  getStorageDownloadUrl,
  isStorageUploadRef,
  storagePathFromRef,
} from '../storageUpload.js';
import { lockBodyScroll } from '../lockBodyScroll.js';

function asFileItems(value: unknown): Array<File | string> {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is File | string =>
        (typeof File !== 'undefined' && v instanceof File) || typeof v === 'string',
    );
  }
  if (typeof File !== 'undefined' && value instanceof File) return [value];
  if (typeof value === 'string') return [value];
  return [];
}

function fallbackNameFromRef(ref: string): string {
  const path = storagePathFromRef(ref);
  if (path) {
    const seg = path.split('/').pop();
    if (seg) return seg;
  }
  return 'Uploaded file';
}

function isHeicNameOrMime(mime: string, name: string): boolean {
  const m = (mime || '').toLowerCase();
  const n = name.toLowerCase();
  return m.includes('heic') || m.includes('heif') || n.endsWith('.heic') || n.endsWith('.heif');
}

/** Types we can show in the lightbox (HEIC is converted client-side). */
function isPreviewable(mime: string, name: string): boolean {
  const m = (mime || '').toLowerCase();
  const n = name.toLowerCase();
  if (isHeicNameOrMime(m, n)) return true;
  if (m.startsWith('image/')) return true;
  if (m === 'application/pdf' || n.endsWith('.pdf')) return true;
  if (m.startsWith('video/') && (m.includes('mp4') || m.includes('webm'))) return true;
  if (/\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(n)) return true;
  if (/\.(mp4|webm)$/i.test(n)) return true;
  return false;
}

function previewMime(mime: string, name: string): string {
  const m = (mime || '').toLowerCase();
  if (m && m !== 'application/octet-stream') return m;
  const n = name.toLowerCase();
  if (/\.pdf$/i.test(n)) return 'application/pdf';
  if (/\.mp4$/i.test(n)) return 'video/mp4';
  if (/\.webm$/i.test(n)) return 'video/webm';
  if (/\.png$/i.test(n)) return 'image/png';
  if (/\.gif$/i.test(n)) return 'image/gif';
  if (/\.webp$/i.test(n)) return 'image/webp';
  if (/\.(jpe?g)$/i.test(n)) return 'image/jpeg';
  if (/\.heic$/i.test(n)) return 'image/heic';
  if (/\.heif$/i.test(n)) return 'image/heif';
  return m || 'application/octet-stream';
}

async function resolveFileAccess(item: File | string): Promise<{
  url: string;
  revoke: boolean;
  meta: FileUploadMeta;
} | null> {
  if (typeof File !== 'undefined' && item instanceof File) {
    return {
      url: URL.createObjectURL(item),
      revoke: true,
      meta: {
        name: item.name,
        size: item.size,
        mime: item.type || 'application/octet-stream',
      },
    };
  }
  if (typeof item !== 'string') return null;

  if (/^https?:\/\//i.test(item)) {
    return {
      url: item,
      revoke: false,
      meta: { name: item.split('/').pop() ?? item, size: 0, mime: '' },
    };
  }

  if (!isFileUploadRef(item)) return null;

  const resolved =
    (await resolveUploadMeta(item)) ??
    ({
      name: fallbackNameFromRef(item),
      size: 0,
      mime: 'application/octet-stream',
    } satisfies FileUploadMeta);

  // Prefer Function-proxied bytes (CORS-safe) over a raw signed S3 URL.
  if (isStorageUploadRef(item)) {
    const content = await getStorageContentBlob(item);
    if (content) {
      return {
        url: URL.createObjectURL(content.blob),
        revoke: true,
        meta: {
          name: resolved.name || content.name,
          size: content.blob.size || resolved.size,
          mime: content.mime || resolved.mime,
        },
      };
    }
    const url = await getStorageDownloadUrl(item);
    if (!url) return null;
    return { url, revoke: false, meta: resolved };
  }

  const blob = await getLocalUploadBlob(item);
  if (!blob) return null;
  return {
    url: URL.createObjectURL(blob),
    revoke: true,
    meta: {
      name: resolved.name,
      size: blob.size || resolved.size,
      mime: blob.type || resolved.mime,
    },
  };
}

/**
 * Fast list thumb: CORS-safe blob URL (signed S3 URLs often break in <img>).
 * Cached per ref so scrolling Responses doesn’t re-download.
 */
const listThumbCache = new Map<
  string,
  { url: string; meta: FileUploadMeta; revoke: boolean }
>();

async function resolveListThumb(item: File | string): Promise<{
  url: string;
  revoke: boolean;
  meta: FileUploadMeta;
} | null> {
  if (typeof File !== 'undefined' && item instanceof File) {
    const mime = item.type || previewMime('', item.name);
    if (!mime.startsWith('image/') || isHeicNameOrMime(mime, item.name)) {
      return resolveFileAccess(item);
    }
    return {
      url: URL.createObjectURL(item),
      revoke: true,
      meta: { name: item.name, size: item.size, mime },
    };
  }
  if (typeof item !== 'string' || !isFileUploadRef(item)) {
    return resolveFileAccess(item);
  }

  const cached = listThumbCache.get(item);
  if (cached) {
    return { url: cached.url, revoke: false, meta: cached.meta };
  }

  const nameGuess = fallbackNameFromRef(item);
  const mimeGuess = previewMime('', nameGuess);

  if (
    isStorageUploadRef(item) &&
    (mimeGuess.startsWith('image/') || isHeicNameOrMime(mimeGuess, nameGuess))
  ) {
    const [meta, content] = await Promise.all([
      resolveUploadMeta(item),
      getStorageContentBlob(item),
    ]);
    if (!content) return null;

    const resolved: FileUploadMeta = meta ?? {
      name: nameGuess,
      size: content.blob.size,
      mime: content.mime || mimeGuess || 'image/jpeg',
    };
    const mime = previewMime(resolved.mime || content.mime, resolved.name);

    let url: string;
    let revoke = false;
    if (isHeicNameOrMime(mime, resolved.name)) {
      try {
        const file = new File([content.blob], resolved.name, {
          type: mime.includes('heif') ? 'image/heif' : 'image/heic',
        });
        const jpeg = await convertHeicToJpegFile(file);
        url = URL.createObjectURL(jpeg);
        resolved.mime = 'image/jpeg';
        resolved.name = jpeg.name || resolved.name;
      } catch {
        return null;
      }
    } else {
      url = URL.createObjectURL(content.blob);
    }

    // Cache owns the object URL for the session — FileRow must not revoke it.
    listThumbCache.set(item, {
      url,
      meta: {
        ...resolved,
        mime: resolved.mime || mime,
        size: content.blob.size || resolved.size,
      },
      revoke,
    });
    const hit = listThumbCache.get(item)!;
    return { url: hit.url, revoke: false, meta: hit.meta };
  }

  return resolveFileAccess(item);
}

/**
 * Build a browser-displayable preview URL.
 * HEIC/HEIF → JPEG via heic2any. Other files → blob URL when fetch works.
 */
async function buildDisplayPreview(
  sourceUrl: string,
  meta: FileUploadMeta,
  sourceRevoke: boolean,
): Promise<{ url: string; revoke: boolean; mime: string; name: string }> {
  let blob: Blob | null = null;

  if (sourceUrl.startsWith('blob:')) {
    try {
      const res = await fetch(sourceUrl);
      if (res.ok) blob = await res.blob();
    } catch {
      /* fall through */
    }
  } else {
    try {
      const res = await fetch(sourceUrl);
      if (res.ok) blob = await res.blob();
    } catch {
      /* CORS — use signed URL directly for non-HEIC */
    }
  }

  const mime = previewMime(meta.mime || blob?.type || '', meta.name);
  const name = meta.name;

  if (blob && isHeicNameOrMime(mime, name)) {
    try {
      const file = new File([blob], name, { type: mime.includes('heif') ? 'image/heif' : 'image/heic' });
      const jpeg = await convertHeicToJpegFile(file);
      if (sourceRevoke) URL.revokeObjectURL(sourceUrl);
      return {
        url: URL.createObjectURL(jpeg),
        revoke: true,
        mime: 'image/jpeg',
        name: jpeg.name,
      };
    } catch (err) {
      if (sourceRevoke) URL.revokeObjectURL(sourceUrl);
      throw err instanceof Error
        ? err
        : new Error('Could not convert HEIC for preview.');
    }
  }

  if (blob) {
    if (sourceRevoke) URL.revokeObjectURL(sourceUrl);
    return {
      url: URL.createObjectURL(blob),
      revoke: true,
      mime: blob.type || mime,
      name,
    };
  }

  // Can't fetch (CORS) and not HEIC — <img src=signedUrl> often still works.
  if (isHeicNameOrMime(mime, name)) {
    if (sourceRevoke) URL.revokeObjectURL(sourceUrl);
    throw new Error('Could not load HEIC for conversion (storage CORS). Use Download.');
  }

  return { url: sourceUrl, revoke: sourceRevoke, mime, name };
}

function FileLightbox({
  name,
  mime,
  url,
  loading,
  loadError,
  onClose,
}: {
  name: string;
  mime: string;
  url: string | null;
  loading: boolean;
  loadError: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(Date.now());
  const resolvedMime = previewMime(mime, name);
  const isPdf = resolvedMime === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
  const isVideo = resolvedMime.startsWith('video/');

  useEffect(() => {
    openedAt.current = Date.now();
    closeBtnRef.current?.focus({ preventScroll: true });
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const unlock = lockBodyScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [onClose]);

  const dismissBackdrop = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (Date.now() - openedAt.current < 400) return;
    onClose();
  };

  return createPortal(
    <div
      className="slate-file-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={dismissBackdrop}
    >
      <div className="slate-file-lightbox-bar">
        <span id={titleId} className="slate-file-lightbox-title">
          {name}
        </span>
        <button
          ref={closeBtnRef}
          type="button"
          className="slate-file-lightbox-close"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="slate-file-lightbox-body">
        {loadError ? (
          <p className="slate-file-lightbox-status">{loadError}</p>
        ) : loading && !url ? (
          <p className="slate-file-lightbox-status">
            {isHeicNameOrMime(mime, name) ? 'Converting HEIC…' : 'Loading preview…'}
          </p>
        ) : url && isPdf ? (
          <iframe title={name} src={url} className="slate-file-lightbox-frame" />
        ) : url && isVideo ? (
          <video src={url} controls className="slate-file-lightbox-media" />
        ) : url ? (
          <img src={url} alt={name} className="slate-file-lightbox-media" />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function FileRow({ item }: { item: File | string }) {
  const [meta, setMeta] = useState<FileUploadMeta | null>(() => {
    if (typeof File !== 'undefined' && item instanceof File) {
      return { name: item.name, size: item.size, mime: item.type || 'application/octet-stream' };
    }
    if (typeof item === 'string' && isFileUploadRef(item)) {
      return {
        name: fallbackNameFromRef(item),
        size: 0,
        mime: previewMime('', fallbackNameFromRef(item)),
      };
    }
    return null;
  });
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    name: string;
    mime: string;
    url: string | null;
    revoke: boolean;
    loading: boolean;
    loadError: string | null;
  } | null>(null);
  const thumbRevokeRef = useRef<string | null>(null);
  const previewGen = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setThumbLoading(true);

    void (async () => {
      const access = await resolveListThumb(item);
      if (cancelled || !access) {
        if (!cancelled) setThumbLoading(false);
        return;
      }
      setMeta(access.meta);

      const mime = previewMime(access.meta.mime, access.meta.name);
      // Blob / object URLs from resolveListThumb — never put failing signed S3 URLs in <img>.
      if (
        isPreviewable(access.meta.mime, access.meta.name) &&
        mime.startsWith('image/') &&
        !isHeicNameOrMime(mime, access.meta.name)
      ) {
        if (access.revoke && thumbRevokeRef.current) {
          URL.revokeObjectURL(thumbRevokeRef.current);
        }
        // Only track revoke for non-cached (File) blobs.
        thumbRevokeRef.current = access.revoke ? access.url : null;
        setThumbUrl(access.url);
        setThumbLoading(false);
        return;
      }

      // HEIC already converted inside resolveListThumb when possible.
      if (access.url && mime.startsWith('image/')) {
        thumbRevokeRef.current = access.revoke ? access.url : null;
        setThumbUrl(access.url);
      } else if (access.revoke) {
        URL.revokeObjectURL(access.url);
      }
      if (!cancelled) setThumbLoading(false);
    })();

    return () => {
      cancelled = true;
      if (thumbRevokeRef.current) {
        URL.revokeObjectURL(thumbRevokeRef.current);
        thumbRevokeRef.current = null;
      }
    };
  }, [item]);

  const closeLightbox = useCallback(() => {
    previewGen.current += 1;
    setLightbox((current) => {
      if (current?.revoke && current.url && current.url !== thumbUrl) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
    setBusy(null);
  }, [thumbUrl]);

  const fileName =
    meta?.name ??
    (typeof File !== 'undefined' && item instanceof File
      ? item.name
      : typeof item === 'string'
        ? fallbackNameFromRef(item)
        : 'Uploaded file');
  const canPreview = meta ? isPreviewable(meta.mime, meta.name) : true;

  const preview = async () => {
    setError(null);
    if (meta && !canPreview) {
      setError('Preview isn’t available for this file type — use Download.');
      return;
    }

    const gen = ++previewGen.current;
    setBusy('preview');

    const heic = meta ? isHeicNameOrMime(meta.mime, meta.name) : false;

    // Open shell immediately. Reuse non-HEIC thumb when we have one.
    setLightbox({
      name: fileName,
      mime: meta ? previewMime(meta.mime, meta.name) : '',
      url: thumbUrl && !heic ? thumbUrl : null,
      revoke: false,
      loading: !(thumbUrl && !heic),
      loadError: null,
    });

    // Instant: thumb already covers JPEG/PNG lightbox.
    if (thumbUrl && !heic) {
      setBusy(null);
      return;
    }

    try {
      const access = await resolveFileAccess(item);
      if (gen !== previewGen.current) {
        if (access?.revoke) URL.revokeObjectURL(access.url);
        return;
      }
      if (!access) {
        setLightbox((cur) =>
          cur ? { ...cur, loading: false, loadError: 'Could not load file for preview.' } : cur,
        );
        return;
      }
      if (!isPreviewable(access.meta.mime, access.meta.name)) {
        if (access.revoke) URL.revokeObjectURL(access.url);
        setLightbox(null);
        setError('Preview isn’t available for this file type — use Download.');
        return;
      }

      const mime = previewMime(access.meta.mime, access.meta.name);
      setLightbox((cur) =>
        cur
          ? {
              ...cur,
              name: access.meta.name,
              mime,
              loading: true,
              loadError: null,
            }
          : cur,
      );

      const display = await buildDisplayPreview(access.url, access.meta, access.revoke);
      if (gen !== previewGen.current) {
        if (display.revoke) URL.revokeObjectURL(display.url);
        return;
      }

      setLightbox({
        name: display.name,
        mime: display.mime,
        url: display.url,
        revoke: display.revoke,
        loading: false,
        loadError: null,
      });
    } catch (err) {
      if (gen !== previewGen.current) return;
      const message =
        err instanceof Error ? err.message : 'Could not load file for preview.';
      setLightbox((cur) => (cur ? { ...cur, loading: false, loadError: message } : cur));
    } finally {
      if (gen === previewGen.current) setBusy(null);
    }
  };

  const download = async () => {
    setError(null);
    setBusy('download');
    try {
      const access = await resolveFileAccess(item);
      if (!access) {
        setError('Could not download file.');
        return;
      }

      try {
        const res = await fetch(access.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = access.meta.name || 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch {
        const a = document.createElement('a');
        a.href = access.url;
        a.download = access.meta.name || 'download';
        a.rel = 'noopener';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        if (access.revoke) URL.revokeObjectURL(access.url);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="slate-response-file">
        {thumbUrl ? (
          <button
            type="button"
            className="slate-response-file-thumb-btn"
            onClick={() => void preview()}
            aria-label={`Preview ${fileName}`}
          >
            <img
              src={thumbUrl}
              alt=""
              className="slate-response-file-thumb"
              referrerPolicy="no-referrer"
              onError={() => {
                if (thumbRevokeRef.current) {
                  URL.revokeObjectURL(thumbRevokeRef.current);
                  thumbRevokeRef.current = null;
                }
                setThumbUrl(null);
                setThumbLoading(false);
              }}
            />
          </button>
        ) : (
          <span
            className={`slate-response-file-badge${thumbLoading ? ' slate-response-file-badge--loading' : ''}`}
            aria-hidden
          >
            {thumbLoading ? (
              ''
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.75"
                />
                <circle cx="9" cy="10" r="1.75" fill="currentColor" />
                <path
                  d="M3 16.5 8.5 12l3.5 3 3-2.5L21 16.5"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        )}
        <div className="slate-response-file-meta">
          <span className="slate-response-file-name">{fileName}</span>
          {meta && meta.size > 0 && (
            <span className="slate-response-file-size">{formatBytes(meta.size)}</span>
          )}
          {error && <span className="slate-response-file-err">{error}</span>}
        </div>
        <div className="slate-response-file-actions">
          <button
            type="button"
            className="slate-btn slate-btn--compact"
            onClick={() => void preview()}
            disabled={busy === 'download' || (meta !== null && !canPreview)}
            title={
              meta && !canPreview
                ? 'Preview not available for this file type'
                : 'Preview in lightbox'
            }
          >
            {busy === 'preview' ? '…' : 'Preview'}
          </button>
          <button
            type="button"
            className="slate-btn slate-btn--compact slate-btn--primary"
            onClick={() => void download()}
            disabled={busy !== null}
          >
            {busy === 'download' ? '…' : 'Download'}
          </button>
        </div>
      </div>
      {lightbox && (
        <FileLightbox
          name={lightbox.name}
          mime={lightbox.mime}
          url={lightbox.url}
          loading={lightbox.loading}
          loadError={lightbox.loadError}
          onClose={closeLightbox}
        />
      )}
    </>
  );
}

export function ResponseFileAnswer({ value }: { value: unknown }) {
  const items = asFileItems(value);
  if (items.length === 0) {
    return <span style={{ color: 'var(--slate-muted)' }}>—</span>;
  }
  return (
    <div className="slate-response-files">
      {items.map((item, i) => (
        <FileRow
          key={typeof item === 'string' ? item : `${item.name}-${item.size}-${i}`}
          item={item}
        />
      ))}
    </div>
  );
}
