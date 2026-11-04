/**
 * Slate · QR codes editor (ADR-075): one code's link, name, kind and look,
 * with a live preview and the PNG / SVG downloads.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { useToast } from '../toast.js';
import { copyText } from '../shareUrls.js';
import { AdminShell } from '../shell/AdminShell.js';
import {
  createQrCode,
  getQrCode,
  isQrLoaded,
  qrScanCount,
  isQrQuotaError,
  loadQrCodes,
  QrTargetError,
  setQrDestination,
  subscribeQr,
  updateQrCode,
} from '../qr/qrStore.js';
import {
  colorProblem,
  DEFAULT_QR_STYLE,
  destinationProblem,
  displayName,
  downloadBaseName,
  normalizeDestination,
  normalizeHex,
  QR_CAPTION_MAX,
  QR_NAME_MAX,
  qrContent,
  qrShortUrl,
  type QrKind,
  type QrRecord,
  type QrStyle,
} from '../qr/qrModel.js';
import {
  downloadQrPng,
  downloadQrSvg,
  prepareQrLogo,
  qrDrawProblem,
  qrPreviewSrc,
} from '../qr/qrExport.js';
import { QR_PRESETS } from '../qr/qrRender.js';

type Draft = {
  name: string;
  link: string;
  kind: QrKind;
  style: QrStyle;
};

function draftOf(record: QrRecord | null): Draft {
  return {
    name: record?.name ?? '',
    link: record?.targetUrl ?? '',
    kind: record?.kind ?? 'static',
    style: record?.style ?? DEFAULT_QR_STYLE,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Stand-in short link for the preview before the database draws the real one. */
const PREVIEW_CODE = 'xxxxxxxx';

export function QrEditor({ qrId }: { qrId: string | null }) {
  const [, setVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => subscribeQr(() => setVersion((n) => n + 1)), []);
  useEffect(() => {
    loadQrCodes().catch((err: unknown) => {
      console.error('[slate] loading QR codes failed:', err);
      setLoadError('Couldn’t load your QR codes. Check your connection and try again.');
    });
  }, []);

  const record = qrId ? getQrCode(qrId) : null;
  const backToList = (
    <span className="slate-crumb">
      <button type="button" className="slate-link" onClick={() => navigate('/qr')}>
        QR codes
      </button>
    </span>
  );

  if (loadError || !isQrLoaded() || (qrId && !record)) {
    return (
      <AdminShell
        crumbs={backToList}
        phone={{ back: { label: 'QR codes', onClick: () => navigate('/qr') }, title: 'QR code' }}
      >
        {loadError || (isQrLoaded() && qrId && !record) ? (
          <div className="slate-empty" role={loadError ? 'alert' : undefined}>
            <p style={{ margin: '0 0 12px' }}>{loadError ?? 'That QR code isn’t here anymore.'}</p>
            <button
              type="button"
              className="slate-btn slate-btn--primary"
              onClick={() => navigate('/qr')}
            >
              Back to QR codes
            </button>
          </div>
        ) : null}
      </AdminShell>
    );
  }

  // Remount when switching codes so the draft starts from the right record.
  return <QrEditorBody key={qrId ?? 'new'} record={record} />;
}

function QrEditorBody({ record }: { record: QrRecord | null }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [saved, setSaved] = useState<Draft>(() => draftOf(record));
  const [draft, setDraft] = useState<Draft>(() => draftOf(record));
  const [linkTouched, setLinkTouched] = useState(Boolean(record));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const creating = !record;
  const dirty = !sameDraft(draft, saved);

  // Unsaved changes survive an accidental tab close.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const linkProblem = destinationProblem(draft.link);
  const normalizedLink = normalizeDestination(draft.link);
  const colors = colorProblem(draft.style.fg, draft.style.bg);
  const content =
    draft.kind === 'dynamic'
      ? record?.code
        ? qrShortUrl(record.code)
        : qrShortUrl(PREVIEW_CODE)
      : (normalizedLink ?? 'https://example.com');
  const drawProblem =
    linkProblem && draft.kind === 'static' ? null : qrDrawProblem(content, draft.style);
  const previewSrc = useMemo(
    () => (colors ? null : qrPreviewSrc(content, draft.style, 360)),
    [content, draft.style, colors],
  );
  // No link yet: the preview shows the look on a stand-in link, dimmed.
  const sample = draft.kind === 'static' && !normalizedLink;
  const canSave = !saving && dirty && !linkProblem && !colors && !drawProblem;
  const savedContent = record ? qrContent(record) : null;
  const downloadsReady = Boolean(savedContent) && !dirty;

  const setStyle = (patch: Partial<QrStyle>) =>
    setDraft((d) => {
      const style: QrStyle = { ...d.style, ...patch };
      if (patch.logo === undefined && 'logo' in patch) delete style.logo;
      if (patch.caption !== undefined && !patch.caption) delete style.caption;
      return { ...d, style };
    });

  const leave = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard your changes?',
        message: 'You have changes that aren’t saved.',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
    }
    navigate('/qr');
  };

  const save = async () => {
    setLinkTouched(true);
    if (!canSave || !normalizedLink) return;
    setSaving(true);
    setSaveError(null);
    const next: Draft = { ...draft, link: normalizedLink };
    try {
      if (creating) {
        let created: QrRecord;
        try {
          created = await createQrCode({
            name: next.name,
            kind: next.kind,
            targetUrl: next.link,
            style: next.style,
          });
        } catch (err) {
          // The code exists; only its destination was refused. Open it so the owner can fix the link.
          if (err instanceof QrTargetError && err.record) {
            toast.push({
              title: 'Code saved without its link',
              detail: err.message,
              tone: 'error',
            });
            navigate(`/qr/${err.record.id}/edit`);
            return;
          }
          throw err;
        }
        setSaved(next);
        setDraft(next);
        toast.push({ title: 'QR code saved', tone: 'success' });
        navigate(`/qr/${created.id}/edit`);
        return;
      }

      if (next.kind === 'dynamic' && next.link !== saved.link) {
        await setQrDestination(record.id, next.link);
      }
      if (
        next.name !== saved.name ||
        !sameStyle(next.style, saved.style) ||
        (next.kind === 'static' && next.link !== saved.link)
      ) {
        await updateQrCode(record.id, {
          name: next.name,
          style: next.style,
          ...(next.kind === 'static' ? { targetUrl: next.link } : {}),
        });
      }
      setSaved(next);
      setDraft(next);
      toast.push({ title: 'Saved', tone: 'success' });
    } catch (err) {
      if (err instanceof QrTargetError) {
        setSaveError(err.message);
      } else if (isQrQuotaError(err)) {
        setSaveError(
          'You’ve reached the QR code limit. Delete codes forever from Trash to make room.',
        );
      } else {
        console.error('[slate] saving QR code failed:', err);
        setSaveError('Couldn’t save. Check your connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const onLogoFile = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      const logo = await prepareQrLogo(file, draft.style.bg);
      setStyle({ logo });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Couldn’t use that image.');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (kind: 'png' | 'svg') => {
    if (!record || !savedContent) return;
    try {
      if (kind === 'png') await downloadQrPng(savedContent, record.style, downloadBaseName(record));
      else downloadQrSvg(savedContent, record.style, downloadBaseName(record));
    } catch {
      toast.push({ title: `Couldn’t make the ${kind.toUpperCase()}`, tone: 'error' });
    }
  };

  const title = creating ? 'New QR code' : displayName(record);
  const saveLabel = saving
    ? 'Saving…'
    : creating
      ? 'Save QR code'
      : dirty
        ? 'Save changes'
        : 'Saved';
  const saveButton = (
    <button
      type="button"
      className="slate-btn slate-btn--primary"
      onClick={() => void save()}
      disabled={!canSave}
    >
      {saveLabel}
    </button>
  );

  return (
    <AdminShell
      crumbs={
        <span className="slate-crumb">
          <button type="button" className="slate-link" onClick={() => void leave()}>
            QR codes
          </button>
          {' / '}
          <span style={{ color: 'var(--slate-text)' }}>{title}</span>
        </span>
      }
      rightSlot={<div className="slate-header-actions">{saveButton}</div>}
      phone={{
        back: { label: 'QR codes', onClick: () => void leave() },
        title,
        subtitle: dirty ? 'Unsaved changes' : creating ? undefined : 'Saved',
        actions: saveButton,
      }}
    >
      <div className="slate-qr-editor">
        <div className="slate-qr-fields">
          <Field label="Link" htmlFor="qr-link" error={linkTouched ? linkProblem : null}>
            <input
              id="qr-link"
              className="slate-input"
              type="url"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="example.com/menu"
              value={draft.link}
              onChange={(e) => setDraft((d) => ({ ...d, link: e.target.value }))}
              onBlur={() => {
                setLinkTouched(true);
                const n = normalizeDestination(draft.link);
                if (n && n !== draft.link) setDraft((d) => ({ ...d, link: n }));
              }}
              aria-invalid={linkTouched && linkProblem ? true : undefined}
            />
            {!creating && draft.kind === 'static' && draft.link !== saved.link ? (
              <p className="slate-help slate-qr-warn">
                A static code holds its link, so a new link is a new code. Reprint anything already
                printed.
              </p>
            ) : null}
          </Field>

          <Field label="Name" htmlFor="qr-name" hint="Only you see this.">
            <input
              id="qr-name"
              className="slate-input"
              type="text"
              maxLength={QR_NAME_MAX}
              placeholder="Lunch menu"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>

          <fieldset className="slate-qr-fieldset">
            <legend className="slate-label">Type</legend>
            {creating ? (
              <div className="slate-qr-kinds">
                <KindOption
                  kind="static"
                  current={draft.kind}
                  onPick={(kind) => setDraft((d) => ({ ...d, kind }))}
                  title="Static"
                  copy="The link lives inside the code. Works forever, never counted, can’t be changed once printed."
                />
                <KindOption
                  kind="dynamic"
                  current={draft.kind}
                  onPick={(kind) => setDraft((d) => ({ ...d, kind }))}
                  title="Dynamic"
                  copy="The code holds a short Slate link. Change where it goes anytime and see how many people scan it."
                />
              </div>
            ) : (
              <p className="slate-qr-kind-fixed">
                <strong>{record.kind === 'dynamic' ? 'Dynamic' : 'Static'}.</strong>{' '}
                {record.kind === 'dynamic'
                  ? 'Change the link anytime; printed copies follow it.'
                  : 'The link is inside the code itself.'}{' '}
                <span className="slate-qr-dim">The type can’t change after a code is made.</span>
              </p>
            )}
          </fieldset>

          <fieldset className="slate-qr-fieldset">
            <legend className="slate-label">Style</legend>
            <div className="slate-share-style-pills" role="radiogroup" aria-label="QR style">
              {QR_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.style.preset === option.id}
                  className={`slate-share-style-pill${
                    draft.style.preset === option.id ? ' slate-share-style-pill--active' : ''
                  }`}
                  title={option.description}
                  onClick={() => setStyle({ preset: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="slate-qr-fieldset">
            <legend className="slate-label">Colors</legend>
            <div className="slate-qr-colors">
              <ColorField
                id="qr-fg"
                label="Code"
                value={draft.style.fg}
                onChange={(fg) => setStyle({ fg })}
              />
              <ColorField
                id="qr-bg"
                label="Background"
                value={draft.style.bg}
                onChange={(bg) => setStyle({ bg })}
              />
              {draft.style.fg !== DEFAULT_QR_STYLE.fg || draft.style.bg !== DEFAULT_QR_STYLE.bg ? (
                <button
                  type="button"
                  className="slate-btn slate-btn--compact"
                  onClick={() => setStyle({ fg: DEFAULT_QR_STYLE.fg, bg: DEFAULT_QR_STYLE.bg })}
                >
                  Reset
                </button>
              ) : null}
            </div>
            {colors ? (
              <p className="slate-qr-error" role="alert">
                {colors}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="slate-qr-fieldset">
            <legend className="slate-label">Logo</legend>
            <div className="slate-qr-logo-row">
              {draft.style.logo ? (
                <img className="slate-qr-logo-thumb" src={draft.style.logo} alt="Your logo" />
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                hidden
                onChange={(e) => void onLogoFile(e.target.files?.[0])}
              />
              <button
                type="button"
                className="slate-btn slate-btn--compact"
                onClick={() => fileRef.current?.click()}
                disabled={logoBusy}
              >
                {logoBusy ? 'Adding…' : draft.style.logo ? 'Replace logo' : 'Add a logo'}
              </button>
              {draft.style.logo ? (
                <button
                  type="button"
                  className="slate-btn slate-btn--compact"
                  onClick={() => setStyle({ logo: undefined })}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <p className="slate-help">
              {draft.style.preset === 'branded' && !draft.style.logo
                ? 'Mark shows the Slate mark until you add your own.'
                : 'Sits in the middle of the code. PNG with a clear background looks best.'}
            </p>
            {logoError ? (
              <p className="slate-qr-error" role="alert">
                {logoError}
              </p>
            ) : null}
          </fieldset>

          <Field
            label="Caption"
            htmlFor="qr-caption"
            hint={`Printed under the code, like “Scan for the menu”. ${
              (draft.style.caption ?? '').length
            }/${QR_CAPTION_MAX}`}
          >
            <input
              id="qr-caption"
              className="slate-input"
              type="text"
              maxLength={QR_CAPTION_MAX}
              placeholder="Scan me"
              value={draft.style.caption ?? ''}
              onChange={(e) => setStyle({ caption: e.target.value })}
            />
          </Field>
        </div>

        <aside className="slate-qr-preview" aria-label="Preview">
          <div className="slate-qr-preview-frame" style={{ background: draft.style.bg }}>
            {previewSrc ? (
              <img
                src={previewSrc}
                alt={sample ? 'Sample QR code' : `QR code for ${draft.link}`}
                className={sample ? 'slate-qr-preview-sample' : undefined}
              />
            ) : (
              <div className="slate-qr-preview-empty">
                {colors ? 'Fix the colors to see your code.' : (drawProblem ?? '')}
              </div>
            )}
          </div>
          {sample && previewSrc ? (
            <p className="slate-qr-dim slate-qr-center">Paste a link to see your code.</p>
          ) : null}
          {drawProblem && !colors ? (
            <p className="slate-qr-error" role="alert">
              {drawProblem}
            </p>
          ) : null}
          {draft.kind === 'dynamic' ? (
            record?.code ? (
              <ShortLink url={qrShortUrl(record.code)} onCopy={copyText} />
            ) : (
              <p className="slate-qr-dim slate-qr-center">Your short link appears when you save.</p>
            )
          ) : null}
          {record?.kind === 'dynamic' && record.targetUrl ? (
            <p className="slate-qr-dim slate-qr-center">
              {scanLabel(qrScanCount(record.id))} · repeat scans from one phone count once per 30
              minutes
            </p>
          ) : null}
          {record?.kind === 'dynamic' && !record.targetUrl ? (
            <p className="slate-qr-warn slate-qr-center">
              No link yet: scans show “This code isn’t active right now”.
            </p>
          ) : null}
          {saveError ? (
            <p className="slate-qr-error slate-qr-center" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="slate-qr-downloads">
            <button
              type="button"
              className="slate-btn"
              disabled={!downloadsReady}
              onClick={() => void download('png')}
            >
              Download PNG
            </button>
            <button
              type="button"
              className="slate-btn"
              disabled={!downloadsReady}
              onClick={() => void download('svg')}
            >
              Download SVG
            </button>
          </div>
          {!downloadsReady ? (
            <p className="slate-qr-dim slate-qr-center">
              {creating ? 'Save to download.' : 'Save your changes to download.'}
            </p>
          ) : (
            <p className="slate-qr-dim slate-qr-center">
              Scan it with your phone before you print.
            </p>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}

function scanLabel(n: number): string {
  return n === 0 ? 'No scans yet' : `${n.toLocaleString()} ${n === 1 ? 'scan' : 'scans'}`;
}

function sameStyle(a: QrStyle, b: QrStyle): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="slate-qr-field">
      <label className="slate-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="slate-qr-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="slate-help">{hint}</p>
      ) : null}
    </div>
  );
}

function KindOption({
  kind,
  current,
  onPick,
  title,
  copy,
}: {
  kind: QrKind;
  current: QrKind;
  onPick: (kind: QrKind) => void;
  title: string;
  copy: string;
}) {
  const on = kind === current;
  return (
    <label className={`slate-qr-kind${on ? ' slate-qr-kind--on' : ''}`}>
      <input type="radio" name="qr-kind" value={kind} checked={on} onChange={() => onPick(kind)} />
      <span className="slate-qr-kind-title">{title}</span>
      <span className="slate-qr-kind-copy">{copy}</span>
    </label>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="slate-qr-color">
      <input
        type="color"
        aria-label={`${label} color`}
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      <div>
        <label className="slate-qr-color-label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="slate-input slate-qr-hex"
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          maxLength={7}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex && hex.length === 7 && e.target.value.replace('#', '').length === 6)
              onChange(hex);
          }}
          onBlur={() => {
            const hex = normalizeHex(text);
            if (hex) onChange(hex);
            else setText(value);
          }}
        />
      </div>
    </div>
  );
}

function ShortLink({ url, onCopy }: { url: string; onCopy: (text: string) => Promise<boolean> }) {
  const toast = useToast();
  return (
    <div className="slate-qr-short">
      <code>{url.replace(/^https:\/\//, '')}</code>
      <button
        type="button"
        className="slate-btn slate-btn--compact"
        onClick={async () => {
          const ok = await onCopy(url);
          toast.push(
            ok
              ? { title: 'Link copied', tone: 'success', sound: 'copy' }
              : { title: 'Couldn’t copy the link', tone: 'error' },
          );
        }}
      >
        Copy
      </button>
    </div>
  );
}
