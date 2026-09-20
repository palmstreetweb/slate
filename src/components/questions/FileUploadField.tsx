'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileUploadQuestion } from '@/types/Question.js';
import type { FileAnswer, FileAnswerItem } from '@/types/Answers.js';
import type { LooseAnswers } from '@/types/Answers.js';
import { validate } from '@/logic/validation.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import {
  describeFileUploadAnswer,
  isFileUploadRef,
  type FileUploadMeta,
} from '@/utils/fileUploadRef.js';
import type { FileUploadHandler } from '@/utils/createFileUploadHandler.js';
import { formatFileUploadError, resolveFileInputAccept } from '@/utils/fileUploadAccept.js';
import { isHeicLike, isLikelyImageFile } from '@/utils/imageFileTypes.js';
import { convertHeicToJpegFile } from '@/utils/heicToJpeg.js';
import { shouldOptimizeImage } from '@/utils/prepareFileForUpload.js';
import { resolveTitle } from './_resolveTitle.js';

export type { FileUploadHandler };
export { formatBytes } from '@/utils/fileUploadRef.js';

type Props = {
  question: FileUploadQuestion;
  answers: LooseAnswers;
  initialValue: FileAnswer | undefined;
  onAnswer: (value: FileAnswer | undefined) => void;
  onAdvance: () => void;
  onFileUpload?: FileUploadHandler;
  resolveFileUploadMeta?: (ref: string) => Promise<FileUploadMeta | null>;
};

type PendingFile = {
  id: string;
  file: File;
  previewUrl: string | null;
  phase: 'optimize' | 'upload';
};

function asItemList(value: FileAnswer | undefined, multiple: boolean): FileAnswerItem[] {
  if (value === undefined) return [];
  if (multiple) return Array.isArray(value) ? value : value ? [value] : [];
  if (Array.isArray(value)) return value.slice(0, 1);
  return value ? [value] : [];
}

function itemKey(item: FileAnswerItem, index: number): string {
  if (typeof item === 'string') return item;
  return `file:${item.name}:${item.size}:${item.lastModified}:${index}`;
}

/** Sync preview for already-browser-safe images (not HEIC). */
function syncPreviewUrlForFile(file: File): string | null {
  if (isHeicLike(file)) return null;
  if (isLikelyImageFile(file) || file.type.startsWith('image/')) {
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }
  return null;
}

/** Async preview — converts HEIC/HEIF to a JPEG blob URL browsers can paint. */
async function createPreviewUrlForFile(file: File): Promise<string | null> {
  if (isHeicLike(file)) {
    try {
      const jpeg = await convertHeicToJpegFile(file);
      return URL.createObjectURL(jpeg);
    } catch {
      return null;
    }
  }
  return syncPreviewUrlForFile(file);
}

function extBadge(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() ?? 'FILE';
  return ext.slice(0, 4);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function dragHasFiles(e: DragEvent | React.DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes('Files');
}

export function FileUploadField({
  question,
  answers,
  initialValue,
  onAnswer,
  onAdvance,
  onFileUpload,
  resolveFileUploadMeta,
}: Props) {
  const multiple = question.multiple !== false;
  const maxFiles = question.maxFiles ?? 10;
  const [items, setItems] = useState<FileAnswerItem[]>(() =>
    asItemList(initialValue, multiple),
  );
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [previewByKey, setPreviewByKey] = useState<Record<string, string>>({});
  const [metaByKey, setMetaByKey] = useState<Record<string, FileUploadMeta>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'optimize' | 'upload' | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [screenDrop, setScreenDrop] = useState(false);
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const pickFilesRef = useRef<(files: FileList | File[]) => Promise<void>>(async () => {});
  const previewByKeyRef = useRef(previewByKey);
  previewByKeyRef.current = previewByKey;
  const dragDepthRef = useRef(0);
  const labelId = useId();

  useEffect(() => {
    setPortalHost(rootRef.current?.closest('[data-slate-forms]') ?? null);
  }, []);

  useEffect(() => {
    setItems(asItemList(initialValue, multiple));
  }, [initialValue, multiple]);

  useEffect(() => {
    const refs = items.filter(
      (item): item is string => typeof item === 'string' && isFileUploadRef(item),
    );
    if (!resolveFileUploadMeta || refs.length === 0) return;
    let cancelled = false;
    void Promise.all(
      refs.map(async (ref) => {
        const meta = await resolveFileUploadMeta(ref);
        return [ref, meta] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setMetaByKey((prev) => {
        const next = { ...prev };
        for (const [ref, meta] of pairs) {
          if (meta) next[ref] = meta;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [items, resolveFileUploadMeta]);

  // Object URLs for raw File answers (no host upload path).
  useEffect(() => {
    let cancelled = false;

    setPreviewByKey((prev) => {
      const next = { ...prev };
      items.forEach((item, index) => {
        if (typeof item === 'string') {
          if (isHttpUrl(item) && !next[item]) next[item] = item;
          return;
        }
        const key = itemKey(item, index);
        if (!next[key]) {
          const url = syncPreviewUrlForFile(item);
          if (url) next[key] = url;
        }
      });
      return next;
    });

    // HEIC needs async conversion for a paintable thumb.
    void (async () => {
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        if (typeof item === 'string' || !isHeicLike(item)) continue;
        const key = itemKey(item, index);
        if (previewByKeyRef.current[key]) continue;
        const url = await createPreviewUrlForFile(item);
        if (!url) continue;
        if (cancelled) {
          URL.revokeObjectURL(url);
          continue;
        }
        setPreviewByKey((prev) => {
          if (prev[key]) {
            URL.revokeObjectURL(url);
            return prev;
          }
          return { ...prev, [key]: url };
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewByKeyRef.current)) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      // pending cleaned in its own effect path
    };
  }, []);

  const rememberPreview = useCallback((key: string, url: string | null) => {
    if (!url) return;
    setPreviewByKey((prev) => ({ ...prev, [key]: url }));
  }, []);

  const forgetPreview = useCallback((key: string) => {
    setPreviewByKey((prev) => {
      const url = prev[key];
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const commit = useCallback(
    (next: FileAnswerItem[]) => {
      setItems(next);
      itemsRef.current = next;
      if (multiple) {
        onAnswer(next.length > 0 ? next : undefined);
      } else {
        onAnswer(next[0]);
      }
    },
    [multiple, onAnswer],
  );

  const pickFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    const current = itemsRef.current;
    const room = multiple ? Math.max(0, maxFiles - current.length - pending.length) : 1;
    if (multiple && room === 0) {
      setError(`Attach at most ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`);
      return;
    }

    const batch = multiple ? list.slice(0, room) : list.slice(0, 1);
    for (const file of batch) {
      if (question.maxSizeMb !== undefined && file.size > question.maxSizeMb * 1024 * 1024) {
        setError(`That file is too large — max ${question.maxSizeMb} MB.`);
        return;
      }
    }

    setError(null);

    if (onFileUpload) {
      const nextPending: PendingFile[] = batch.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: syncPreviewUrlForFile(file),
        phase: shouldOptimizeImage(file) ? 'optimize' : 'upload',
      }));
      setPending((prev) => [...prev, ...nextPending]);
      setUploading(true);
      setUploadPhase(nextPending.some((p) => p.phase === 'optimize') ? 'optimize' : 'upload');

      // Warm HEIC thumbs while optimize/upload runs.
      for (const entry of nextPending) {
        if (entry.previewUrl || !isHeicLike(entry.file)) continue;
        void createPreviewUrlForFile(entry.file).then((url) => {
          if (!url) return;
          setPending((prev) => {
            const row = prev.find((p) => p.id === entry.id);
            if (!row) {
              URL.revokeObjectURL(url);
              return prev;
            }
            if (row.previewUrl) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return prev.map((p) => (p.id === entry.id ? { ...p, previewUrl: url } : p));
          });
        });
      }

      const uploaded: FileAnswerItem[] = [];
      try {
        for (const entry of nextPending) {
          setUploadPhase(entry.phase);
          setPending((prev) =>
            prev.map((p) => (p.id === entry.id ? { ...p, phase: entry.phase } : p)),
          );
          // onFileUpload → prepareFileForUpload converts HEIC → photo.jpg, then stores.
          const ref = await onFileUpload(entry.file, question.id, {
            maxSizeMb: question.maxSizeMb,
          });
          uploaded.push(ref);
          const live = pendingRef.current.find((p) => p.id === entry.id);
          const previewUrl = live?.previewUrl ?? entry.previewUrl;
          if (previewUrl) {
            rememberPreview(
              typeof ref === 'string' ? ref : itemKey(ref, 0),
              previewUrl,
            );
          }
          if (resolveFileUploadMeta && isFileUploadRef(ref)) {
            const meta = await resolveFileUploadMeta(ref);
            if (meta) {
              setMetaByKey((prev) => ({ ...prev, [ref]: meta }));
            }
          }
          setPending((prev) => prev.filter((p) => p.id !== entry.id));
        }
        commit(multiple ? [...current, ...uploaded] : uploaded);
      } catch (err: unknown) {
        // Keep files that already uploaded — don't drop successful refs on a later failure.
        if (uploaded.length > 0) {
          commit(multiple ? [...current, ...uploaded] : uploaded);
        }
        setError(formatFileUploadError(err, question.maxSizeMb));
        setPending((prev) => {
          for (const p of prev) {
            if (p.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
          }
          return [];
        });
      } finally {
        setUploading(false);
        setUploadPhase(null);
        if (inputRef.current) inputRef.current.value = '';
      }
      return;
    }

    commit(multiple ? [...current, ...batch] : batch);
    if (inputRef.current) inputRef.current.value = '';
  };

  pickFilesRef.current = pickFiles;

  const canAcceptDrop =
    !uploading &&
    (multiple
      ? items.length + pending.length < maxFiles
      : items.length === 0 && pending.length === 0);

  useEffect(() => {
    if (!canAcceptDrop) {
      dragDepthRef.current = 0;
      setScreenDrop(false);
      return;
    }

    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setScreenDrop(true);
    };
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setScreenDrop(false);
    };
    const clear = () => {
      dragDepthRef.current = 0;
      setScreenDrop(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      clear();
      const files = e.dataTransfer?.files;
      if (files?.length) void pickFilesRef.current(files);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', clear);
    };
  }, [canAcceptDrop]);

  const removeAt = (index: number) => {
    const key = itemKey(items[index]!, index);
    forgetPreview(key);
    if (typeof items[index] === 'string') forgetPreview(items[index] as string);
    const next = items.filter((_, i) => i !== index);
    commit(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  const clearSingle = () => {
    for (const [i, item] of items.entries()) {
      forgetPreview(itemKey(item, i));
      if (typeof item === 'string') forgetPreview(item);
    }
    commit([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const submit = useCallback(() => {
    if (uploading || pending.length > 0) return;
    const value: FileAnswer | undefined = multiple
      ? items.length > 0
        ? items
        : undefined
      : items[0];
    const err = validate(question, value);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    onAdvance();
  }, [uploading, pending.length, question, items, multiple, onAdvance]);

  useRegisterFormConfirm(submit);

  const showZone =
    !uploading &&
    pending.length === 0 &&
    (multiple || items.length === 0);
  const zoneLabel = multiple
    ? items.length > 0
      ? 'add another file'
      : 'choose files'
    : 'choose a file';
  const zoneHint = multiple ? 'or drag and drop them here' : 'or drag and drop it here';
  const totalShown = items.length + pending.length;

  const renderThumb = (
    previewUrl: string | null | undefined,
    label: string,
    badge: string,
    busy?: boolean,
  ) => (
    <span className={`slate-upload-thumb${busy ? ' slate-upload-thumb--busy' : ''}`}>
      {previewUrl ? (
        <img src={previewUrl} alt="" className="slate-upload-thumb-img" />
      ) : (
        <span className="slate-upload-thumb-badge" aria-hidden>
          {badge}
        </span>
      )}
      {busy && <span className="slate-upload-thumb-spinner" aria-hidden />}
    </span>
  );

  const screenDropCopy = multiple ? 'Drop files to upload' : 'Drop your file to upload';

  return (
    <div ref={rootRef}>
      {screenDrop &&
        portalHost &&
        createPortal(
          <div className="slate-upload-screen-drop" role="status" aria-live="assertive">
            <p className="slate-upload-screen-drop-title">{screenDropCopy}</p>
            <p className="slate-upload-screen-drop-hint">Release anywhere to attach</p>
          </div>,
          portalHost,
        )}
      <h1 id={labelId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      <div style={{ marginTop: 24 }}>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          {...(resolveFileInputAccept(question.accept)
            ? { accept: resolveFileInputAccept(question.accept) }
            : {})}
          aria-labelledby={labelId}
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) void pickFiles(files);
          }}
        />

        {(items.length > 0 || pending.length > 0) && (
          <ul className={`slate-upload-list${multiple ? '' : ' slate-upload-list--single'}`}>
            {items.map((item, index) => {
              const key = itemKey(item, index);
              const meta = typeof item === 'string' ? metaByKey[item] ?? null : null;
              const label = describeFileUploadAnswer(item, meta) ?? 'File';
              const name =
                typeof item === 'string'
                  ? meta?.name ?? (isFileUploadRef(item) ? 'File' : item.split('/').pop() ?? 'File')
                  : item.name;
              const preview =
                previewByKey[key] ??
                (typeof item === 'string' ? previewByKey[item] : undefined) ??
                (typeof item === 'string' && isHttpUrl(item) ? item : null);
              const mime = typeof item === 'string' ? meta?.mime : item.type;
              // If we have a blob/http preview URL, show it — including JPEG
              // converted from HEIC (source File may still be .heic).
              const canImg =
                Boolean(preview) &&
                (!mime ||
                  mime.startsWith('image/') ||
                  (typeof item !== 'string' && isHeicLike(item)));
              return (
                <li key={key} className="slate-upload-file">
                  {renderThumb(canImg ? preview : null, label, extBadge(name))}
                  <span className="slate-upload-name">{label}</span>
                  <button
                    type="button"
                    className="slate-upload-remove"
                    onClick={() => (multiple ? removeAt(index) : clearSingle())}
                    aria-label={`Remove ${label}`}
                    disabled={uploading}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {pending.map((entry) => {
              const label = `${entry.file.name} (${entry.phase === 'optimize' ? 'optimizing…' : 'uploading…'})`;
              return (
                <li key={entry.id} className="slate-upload-file slate-upload-file--pending">
                  {renderThumb(
                    entry.previewUrl,
                    label,
                    extBadge(entry.file.name),
                    true,
                  )}
                  <span className="slate-upload-name">{label}</span>
                </li>
              );
            })}
          </ul>
        )}

        {showZone && (
          <button
            type="button"
            className={`slate-upload-zone${dragOver ? ' slate-upload-zone--over' : ''}${
              items.length > 0 ? ' slate-upload-zone--add' : ''
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = e.dataTransfer.files;
              if (files?.length) void pickFiles(files);
            }}
            aria-describedby={labelId}
            disabled={multiple && totalShown >= maxFiles}
          >
            <span className="slate-upload-cta">{zoneLabel}</span>
            <span className="slate-upload-hint">{zoneHint}</span>
          </button>
        )}

        {error && (
          <p className="slate-err" aria-live="polite">
            ! {error}
          </p>
        )}
        <div className="slate-actions">
          <button
            type="button"
            className="slate-ok-btn"
            onClick={submit}
            disabled={uploading || pending.length > 0}
          >
            OK <span aria-hidden>✓</span>
          </button>
          {question.maxSizeMb !== undefined && (
            <span className="slate-hint">max {question.maxSizeMb} MB</span>
          )}
          {multiple && (
            <span className="slate-hint">
              {totalShown}/{maxFiles} files
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
