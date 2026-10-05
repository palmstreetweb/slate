/**
 * Slate Share panel — publish link + portable fallback. Portaled modal; examples/ only.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../useFocusTrap.js';
import type { Schema } from '@/index.js';
import { buildEmbedSnippet, copyText, copyImage } from '../shareUrls.js';
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
  supportsCloseSettings,
  updateForm,
} from '../_formsStore.js';
import { countSubmissions, subscribe as subscribeSubmissions } from '../_submissionStore.js';
import { trackedLinkUrl } from '../trackedLinks.js';
import { closedReason } from '../formClose.js';
import { CloseRow, TrackedLinks } from './ShareExtras.js';
import { isNeonConfigured } from '../neon/env.js';
import { publicFillUrl } from '../neon/publicApi.js';
import { playUiSound } from '../uiSounds.js';
import { useToast } from '../toast.js';
import { lockBodyScroll } from '../lockBodyScroll.js';
import { PublishButton, usePublishIgnition } from '../delight/ignition.js';
import { ownerIssues, publishBlockedCopy } from '../editorIssues.js';
import { navigate } from '../_router.js';

type Props = {
  open: boolean;
  onClose: () => void;
  formId: string;
  formName: string;
  schema: Schema;
  /**
   * Opens a question in the editor: the "Show me" when publishing has to wait
   * (S10). Without it (Dashboard, Responses) "Show me" opens the editor.
   */
  onShowQuestion?: (questionId: string) => void;
};

export function SharePanel({ open, onClose, formId, formName, schema, onShowQuestion }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrStyle, setQrStyle] = useState<ShareQrStyle>(() => readShareQrStyle());
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Publish ignition (ADR-060); `ignited` makes the Live dot fire its sonar.
  const ignite = usePublishIgnition();
  const [ignited, setIgnited] = useState(false);
  const [lockEditing, setLockEditing] = useState(false);
  const [lockDraft, setLockDraft] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  /** Tracked link on show (ADR-063): its `src`, or null for the main link. */
  const [trackSrc, setTrackSrc] = useState<string | null>(null);
  const [, setTick] = useState(0);
  /** Times Publish was pressed while it has to wait; the notice says so again. */
  const [blockedTries, setBlockedTries] = useState(0);

  useEffect(() => {
    if (open) return;
    setIgnited(false);
    setTrackSrc(null);
    setBlockedTries(0);
    // Never keep a typed password around after the sheet closes.
    setLockEditing(false);
    setLockDraft('');
    setLockError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const offForms = subscribe(() => setTick((t) => t + 1));
    // "12 of 20 responses" follows new arrivals while the panel is open.
    const offSubs = subscribeSubmissions(() => setTick((t) => t + 1));
    return () => {
      offForms();
      offSubs();
    };
  }, [open]);

  useFocusTrap(panelRef, open, onClose);

  const form = getForm(formId);
  const isPublished = form?.status === 'published';
  const stale = hasUnpublishedChanges(form);
  const slug = form?.slug ?? formId;

  const productionUrl = isNeonConfigured() && isPublished ? publicFillUrl(slug) : null;
  // A portable link carries the whole schema in the URL — it would walk straight
  // past the password (ADR-043). Locked forms only share the real public link.
  // It also keeps answers on the respondent's own device, so in the cloud it can
  // never send them: an unpublished cloud form gets "Publish" instead (QA COPY-05).
  const portableUrl =
    !isNeonConfigured() && !form?.fillLocked && canEncodePortableSchema(schema)
      ? buildPortableShareUrl(schema, { formId, name: formName })
      : null;
  // Tracked links (ADR-063) build on the published public link; `?src=` is added, never answers.
  const trackBase = isPublished ? publicFillUrl(slug) : null;
  const trackedUrl =
    trackSrc && trackBase && form?.trackedSources?.some((t) => t.src === trackSrc)
      ? trackedLinkUrl(trackBase, trackSrc)
      : null;
  const shareUrl = trackedUrl ?? productionUrl ?? portableUrl;

  /**
   * The QR encodes a SHORT link so the code stays chunky and scannable.
   * The full portable link (which embeds the whole schema) lives in the copy
   * field instead — packing ~2KB into a QR forces a tiny, dense grid.
   */
  const shortFormUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/forms/${formId}/preview`
      : `/forms/${formId}/preview`;
  const qrUrl = shareUrl ? (trackedUrl ?? productionUrl ?? shortFormUrl) : null;

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
          console.error('[slate] QR code failed:', err);
          setQr(null);
          setQrError('Couldn’t make a QR code. Copy the link instead.');
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

  /** Only the published cloud link embeds — a portable link isn't framable (ADR-054). */
  const doCopyEmbed = useCallback(async () => {
    if (!productionUrl) return;
    const ok = await copyText(
      buildEmbedSnippet(productionUrl, formName, (form?.publishedSchema ?? schema).questions),
    );
    if (ok) {
      playUiSound('copy');
      setEmbedCopied(true);
      window.setTimeout(() => setEmbedCopied(false), 2000);
    }
  }, [productionUrl, formName, form?.publishedSchema, schema]);

  const onCopyQr = useCallback(async () => {
    if (!qr) return;
    const ok = await copyImage(qr);
    if (ok) {
      playUiSound('copy');
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 2000);
    }
  }, [qr]);

  /** What would stop people finishing the form: publishing waits for these (S10). */
  const blockingIssues = () =>
    ownerIssues((getForm(formId)?.schema ?? schema).questions).filter((i) => i.blocking);

  const showQuestion = (questionId: string) => {
    if (onShowQuestion) {
      onShowQuestion(questionId);
      return;
    }
    onClose();
    navigate(`/forms/${formId}/edit`);
  };

  const onPublish = () => {
    if (ignite.phase !== 'idle') return;
    if (blockingIssues().length > 0) {
      setBlockedTries((n) => n + 1);
      playUiSound('danger');
      return;
    }
    const wasStale = stale;
    // Set when the publish never reached the server; the shell says so (COPY-10).
    let failed = false;
    // Publishes now; the toast and the Live dot's sonar wait for the check.
    const publish = () =>
      Boolean(
        publishForm(formId, {
          onFail: () => {
            failed = true;
          },
        }),
      );
    const ok = ignite.start(publish, {
      scope: panelRef.current,
      failed: () => failed,
      onLive: () => {
        setIgnited(true);
        toast.push({
          title: wasStale ? 'Republished' : 'You’re live',
          detail: 'Public link is serving this draft.',
          tone: 'success',
          sound: 'success',
        });
      },
    });
    if (!ok) {
      toast.push({
        title: 'Couldn’t publish',
        detail: 'Your form isn’t live yet. Check your connection and try again.',
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
    if (password && password.length < 6) {
      setLockError('Use at least 6 characters.');
      return;
    }
    if (password.length > 72) {
      setLockError('Use 72 characters or fewer.');
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

  const liveResponses = countSubmissions(formId);
  // Closed (ADR-063): the closing row says so in red; a green "Live" beside it would contradict it.
  const closedNow = closedReason(form, liveResponses) !== null;

  // Both need 019's columns in the cloud; without them a setting would vanish on reload.
  const closeSettings = supportsCloseSettings();

  const closeRow =
    form && closeSettings ? (
      <CloseRow
        form={form}
        liveResponses={liveResponses}
        onSave={(patch, note) => {
          const [, ok] = updateForm(formId, patch);
          if (ok)
            toast.push({
              title: note.title,
              detail: note.detail,
              tone: 'success',
              sound: 'success',
            });
          return ok;
        }}
      />
    ) : null;

  const trackedRow =
    form && trackBase && closeSettings ? (
      <TrackedLinks
        sources={form.trackedSources ?? []}
        selected={trackedUrl ? trackSrc : null}
        onSelect={setTrackSrc}
        onChange={(next) => {
          const [, ok] = updateForm(formId, { trackedSources: next.length ? next : undefined });
          return ok;
        }}
      />
    ) : null;

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const cloud = isNeonConfigured();

  // Shown beside Publish while publishing has to wait (S10): what to fix, and a way there.
  const blocked = cloud && (!isPublished || stale) ? blockingIssues() : [];
  const blockedCopy = blocked.length > 0 ? publishBlockedCopy(blocked) : null;
  const blockNotice = blockedCopy ? (
    <section
      key={blockedTries}
      className={`slate-share-block${blockedTries > 0 ? ' slate-share-block--again' : ''}`}
      role={blockedTries > 0 ? 'alert' : 'status'}
      aria-label="Before you publish"
    >
      <p className="slate-share-block-title">{blockedCopy.title}</p>
      <ul className="slate-share-block-list">
        {blockedCopy.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button
        type="button"
        className="slate-share-lock-link"
        onClick={() => showQuestion(blocked[0]!.questionId)}
      >
        Show me
      </button>
    </section>
  ) : null;

  const lockRow = cloud ? (
    <section className="slate-share-lock" aria-label="Password">
      {lockEditing ? (
        <form
          className="slate-share-lock-form"
          // Our own sentence, not the browser's "Please lengthen this text…" bubble (S26).
          noValidate
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
            placeholder={fillLocked ? 'New word or 6+ digits' : 'A word or 6+ digits'}
            aria-label="Form password"
            aria-describedby={`${titleId}-lock-hint`}
            aria-invalid={lockError ? true : undefined}
            minLength={6}
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
            disabled={lockBusy || lockDraft.trim().length === 0}
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
        <p className="slate-share-lock-error" role="alert" id={`${titleId}-lock-hint`}>
          {lockError}
        </p>
      ) : lockEditing ? (
        // The rule up front, so a short password isn't a mystery (S26).
        <p className="slate-share-lock-hint" id={`${titleId}-lock-hint`}>
          At least 6 characters. People type it once per visit.
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
                      value={displayUrl(shareUrl)}
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
                    <span className="slate-share-links">
                      <a
                        href={shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="slate-share-open"
                      >
                        Open in browser
                        <span aria-hidden>↗</span>
                      </a>
                      {productionUrl ? (
                        <button
                          type="button"
                          className={`slate-share-embed${embedCopied ? ' slate-share-embed--done' : ''}`}
                          onClick={() => void doCopyEmbed()}
                          title="Copy HTML that puts this form on a website"
                        >
                          {embedCopied ? (
                            <>
                              Copied <span className="slate-share-embed-more">embed code</span>
                            </>
                          ) : (
                            'Embed'
                          )}
                        </button>
                      ) : null}
                    </span>
                    {cloud ? (
                      ignite.phase !== 'idle' || !isPublished || stale ? (
                        <PublishButton compact phase={ignite.phase} onClick={onPublish}>
                          {isPublished ? 'Republish' : 'Publish'}
                        </PublishButton>
                      ) : (
                        <button
                          type="button"
                          className="slate-btn slate-btn--compact"
                          onClick={onUnpublish}
                          disabled={publishing}
                        >
                          {publishing ? 'Working…' : 'Unpublish'}
                        </button>
                      )
                    ) : null}
                  </div>
                </section>

                {blockNotice}

                {trackedRow}

                {lockRow}

                {closeRow}

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
                  {isPublished && !stale && !closedNow && ignite.phase !== 'working' ? (
                    <p className={`slate-share-live${ignited ? ' slate-share-live--ignite' : ''}`}>
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
                    <PublishButton compact phase={ignite.phase} onClick={onPublish}>
                      Publish
                    </PublishButton>
                  ) : null}
                </div>
                {blockNotice}
                {lockRow}
                {closeRow}
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

/** What the author sees. Copy and the QR still carry the full URL. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
