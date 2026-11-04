/**
 * Slate · QR codes library (ADR-075): the owner's codes and their Trash.
 */

import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { useToast } from '../toast.js';
import { copyText } from '../shareUrls.js';
import { AdminShell } from '../shell/AdminShell.js';
import { usePhone } from '../responses/hooks.js';
import { FormCardIconBtn, IconDelete, IconEdit } from '../components/FormCardIcons.js';
import { IconDownload, IconLink, ToolSwitcher } from '../qr/ToolSwitcher.js';
import {
  deleteQrCodesForever,
  getQrQuota,
  isAtQrQuota,
  isQrLoaded,
  listQrCodes,
  listTrashedQrCodes,
  loadQrCodes,
  qrScanCount,
  restoreAllQrCodes,
  restoreQrCode,
  subscribeQr,
  trashQrCode,
} from '../qr/qrStore.js';
import { displayName, downloadBaseName, qrContent, type QrRecord } from '../qr/qrModel.js';
import { downloadQrPng, qrPreviewSrc } from '../qr/qrExport.js';

const LOAD_FAILED = 'Couldn’t load your QR codes. Check your connection and try again.';

export function QrCodes() {
  const [, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<'codes' | 'trash'>('codes');
  const [retry, setRetry] = useState(0);
  const phone = usePhone();
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => subscribeQr(() => setVersion((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    loadQrCodes({ force: retry > 0 }).catch((err: unknown) => {
      console.error('[slate] loading QR codes failed:', err);
      if (!cancelled) setLoadError(LOAD_FAILED);
    });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const codes = listQrCodes();
  const trashed = listTrashedQrCodes();
  const quota = getQrQuota();
  const loaded = isQrLoaded();

  const failed = (title: string) =>
    toast.push({ title, detail: 'Check your connection and try again.', tone: 'error' });

  const showQuotaDialog = async () => {
    const openTrash = trashed.length > 0;
    const ok = await confirm({
      title: 'QR code limit reached',
      message: `You can have ${quota.max} QR codes, Trash included.${
        openTrash
          ? ` Trash holds ${trashed.length}. Delete forever from Trash to make room.`
          : ' Move a code to Trash, then delete it forever to make room.'
      }`,
      confirmLabel: openTrash ? 'Open Trash' : 'OK',
      cancelLabel: openTrash ? 'OK' : 'Close',
    });
    if (ok && openTrash) setView('trash');
  };

  const onNew = () => {
    if (isAtQrQuota()) {
      void showQuotaDialog();
      return;
    }
    navigate('/qr/new');
  };

  const newButton = (
    <button type="button" className="slate-btn slate-btn--new" onClick={onNew} disabled={!loaded}>
      <span className="slate-btn-plus" aria-hidden="true">
        +
      </span>{' '}
      New QR code
    </button>
  );

  return (
    <AdminShell
      crumbs={<ToolSwitcher current="qr" />}
      rightSlot={<div className="slate-header-actions">{newButton}</div>}
      phone={{ title: 'QR codes', actions: newButton }}
    >
      <div style={{ marginBottom: 28 }}>
        <h1 className="slate-page-title">{view === 'trash' ? 'Trash' : 'Your QR codes'}</h1>
        <p className="slate-page-sub">
          {!loaded
            ? 'Loading…'
            : view === 'trash'
              ? trashed.length === 0
                ? 'No deleted QR codes.'
                : `${trashed.length} deleted${
                    trashed.some((r) => r.kind === 'dynamic')
                      ? ' · dynamic codes don’t open until you restore them'
                      : ''
                  }`
              : codes.length === 0
                ? `No QR codes yet · ${quota.max} code limit`
                : `${codes.length} ${codes.length === 1 ? 'code' : 'codes'} · ${quota.used} of ${quota.max}${
                    trashed.length > 0 ? ` · ${trashed.length} in trash` : ''
                  }`}
        </p>
        <div className="slate-dash-tabs" role="tablist" aria-label="QR codes library">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'codes'}
            className={`slate-btn slate-btn--compact${view === 'codes' ? ' slate-btn--primary' : ''}`}
            onClick={() => setView('codes')}
          >
            QR codes{codes.length > 0 ? ` (${codes.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'trash'}
            className={`slate-btn slate-btn--compact${view === 'trash' ? ' slate-btn--primary' : ''}`}
            onClick={() => setView('trash')}
          >
            Trash{trashed.length > 0 ? ` (${trashed.length})` : ''}
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="slate-empty" role="alert">
          <p style={{ margin: '0 0 12px' }}>{loadError}</p>
          <button
            type="button"
            className="slate-btn slate-btn--primary"
            onClick={() => setRetry((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : !loaded ? null : view === 'trash' ? (
        trashed.length === 0 ? (
          <div className="slate-empty slate-empty--start">
            <p className="slate-empty-title">Trash is empty</p>
            <p className="slate-empty-copy">
              Deleted QR codes show up here until you restore or remove them forever.
            </p>
          </div>
        ) : (
          <>
            <div className="slate-qr-trash-actions">
              <button
                type="button"
                className="slate-btn"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Restore ${trashed.length} ${trashed.length === 1 ? 'code' : 'codes'}?`,
                    message: 'They open again right away.',
                    confirmLabel: 'Restore all',
                  });
                  if (ok) restoreAllQrCodes().catch(() => failed('Couldn’t restore'));
                }}
              >
                Restore all
              </button>
              <button
                type="button"
                className="slate-btn slate-btn--danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${trashed.length} ${trashed.length === 1 ? 'code' : 'codes'} forever?`,
                    message:
                      'Printed dynamic codes stop working for good, and their links are never reused. This can’t be undone.',
                    confirmLabel: 'Empty trash',
                    danger: true,
                  });
                  if (!ok) return;
                  deleteQrCodesForever(trashed.map((r) => r.id))
                    .then(() => setView('codes'))
                    .catch(() => failed('Couldn’t empty Trash'));
                }}
              >
                Empty trash
              </button>
            </div>
            <div className="slate-form-grid">
              {trashed.map((r) => (
                <QrCard
                  key={r.id}
                  record={r}
                  trashed
                  onRestore={() => restoreQrCode(r.id).catch(() => failed('Couldn’t restore'))}
                  onDelete={async () => {
                    const ok = await confirm({
                      title: `Delete "${displayName(r)}" forever?`,
                      message:
                        r.kind === 'dynamic'
                          ? 'Anything printed with this code stops working for good. This can’t be undone.'
                          : 'This can’t be undone. Printed copies keep working: the link is inside the code.',
                      confirmLabel: 'Delete forever',
                      danger: true,
                    });
                    if (ok) deleteQrCodesForever([r.id]).catch(() => failed('Couldn’t delete'));
                  }}
                />
              ))}
            </div>
          </>
        )
      ) : codes.length === 0 ? (
        <div className="slate-empty slate-empty--start">
          <div className="slate-empty-mark" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="slate-empty-title">
            {trashed.length > 0 ? 'Nothing active right now' : 'No QR codes yet'}
          </p>
          <p className="slate-empty-copy">
            {trashed.length > 0
              ? `Restore a code from Trash, or make a new one ${phone ? 'below' : 'from the top right'}.`
              : 'Make a code for any link: a menu, a review page, your Instagram. No form needed.'}
          </p>
        </div>
      ) : (
        <div className="slate-form-grid">
          {codes.map((r) => (
            <QrCard
              key={r.id}
              record={r}
              onDelete={async () => {
                const ok = await confirm({
                  title: `Move "${displayName(r)}" to trash?`,
                  message:
                    r.kind === 'dynamic'
                      ? 'Printed copies show “This code isn’t active right now” until you restore it.'
                      : 'Printed copies keep working: the link is inside the code.',
                  confirmLabel: 'Move to trash',
                  danger: true,
                });
                if (ok) trashQrCode(r.id).catch(() => failed('Couldn’t move to trash'));
              }}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function QrCard({
  record,
  trashed,
  onRestore,
  onDelete,
}: {
  record: QrRecord;
  trashed?: boolean;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const name = displayName(record);
  const content = qrContent(record);
  const src = useMemo(
    () => (content ? qrPreviewSrc(content, { ...record.style, caption: undefined }, 160) : null),
    [content, record.style],
  );
  const scans = qrScanCount(record.id);
  const host = hostOf(record.targetUrl);

  const copyLink = async () => {
    if (!content) return;
    const ok = await copyText(content);
    toast.push(
      ok
        ? { title: 'Link copied', tone: 'success', sound: 'copy' }
        : { title: 'Couldn’t copy the link', tone: 'error' },
    );
  };

  const download = () => {
    if (!content) return;
    downloadQrPng(content, record.style, downloadBaseName(record)).catch(() =>
      toast.push({ title: 'Couldn’t make the PNG', tone: 'error' }),
    );
  };

  const body = (
    <div className="slate-card-pad slate-qr-card-body">
      <div className="slate-qr-thumb" aria-hidden="true">
        {src ? <img src={src} alt="" width={72} height={72} /> : <span />}
      </div>
      <div style={{ minWidth: 0 }}>
        <span className="slate-card-title">{name}</span>
        <p className="slate-card-meta slate-qr-card-link">{host ?? 'No link yet'}</p>
        <div className="slate-qr-badges">
          <span className="slate-badge">{record.kind === 'dynamic' ? 'Dynamic' : 'Static'}</span>
          {record.kind === 'dynamic' ? (
            record.targetUrl ? (
              <span className={`slate-badge${scans > 0 ? ' slate-badge--accent' : ''}`}>
                {scans} {scans === 1 ? 'scan' : 'scans'}
              </span>
            ) : (
              <span className="slate-badge slate-badge--stale">Needs a link</span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="slate-card">
      {trashed ? (
        body
      ) : (
        <button
          type="button"
          className="slate-card-body-btn"
          onClick={() => navigate(`/qr/${record.id}/edit`)}
          aria-label={`Open ${name}`}
        >
          {body}
        </button>
      )}
      <div className="slate-card-footer">
        <div className="slate-card-toolbar" role="toolbar" aria-label={`Actions for ${name}`}>
          {trashed ? (
            <>
              <button type="button" className="slate-btn slate-btn--compact" onClick={onRestore}>
                Restore
              </button>
              <button
                type="button"
                className="slate-btn slate-btn--compact slate-btn--danger"
                onClick={onDelete}
              >
                Delete forever
              </button>
            </>
          ) : (
            <>
              <FormCardIconBtn label="Edit" onClick={() => navigate(`/qr/${record.id}/edit`)}>
                <IconEdit />
              </FormCardIconBtn>
              {content ? (
                <>
                  <FormCardIconBtn label="Download PNG" onClick={download}>
                    <IconDownload />
                  </FormCardIconBtn>
                  <FormCardIconBtn label="Copy link" onClick={() => void copyLink()}>
                    <IconLink />
                  </FormCardIconBtn>
                </>
              ) : null}
              <FormCardIconBtn label="Move to trash" danger onClick={onDelete}>
                <IconDelete />
              </FormCardIconBtn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}
