/**
 * Camera-first photo checklist (ADR-065), loaded on demand. The owner lists
 * the shots they need ("Front of house", "Roof close-up", "Electrical
 * panel"); each opens the phone's rear camera (`capture="environment"`), or
 * the photo library, and shows its thumbnail with a check as it uploads.
 * Progress reads "3 of 5 photos" and the ring closes when the list is done.
 *
 * Photos go through the host's `onFileUpload` — in Slate the usual image
 * preparation (HEIC → JPEG, 1,920 px, ~450 KB) and the public storage path,
 * size-capped and rate-limited (ADR-050/058). The answer maps each item to
 * its stored ref; the server keeps only this form's own refs.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { PhotoChecklistQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { PHOTO_MAX_BYTES } from '@/logic/media.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions-c.css';

type Shot = { state: 'uploading' | 'done' | 'error'; thumb?: string; error?: string; ref?: string };

const MIB = 1024 * 1024;

/** Thumbnails from this session, by stored ref, so Back and forward keep them. */
const thumbs = new Map<string, string>();

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.4" r="3.4" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9.2" cy="10" r="1.6" />
      <path d="m4.5 17.5 4.8-4.8 3.4 3.4 2.2-2.2 4.6 4.6" />
    </svg>
  );
}

export default function PhotoChecklistField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  ping,
  onFileUpload,
}: ExtFieldProps<PhotoChecklistQuestion>) {
  const titleId = useId();
  const items = question.items ?? [];
  const stored =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const [shots, setShots] = useState<Record<string, Shot>>(() => {
    const out: Record<string, Shot> = {};
    for (const it of items) {
      const ref = stored[it.value];
      if (typeof ref === 'string' && ref) out[it.value] = { state: 'done', ref, thumb: thumbs.get(ref) };
    }
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const pending = useRef<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<Record<string, string>>(
    Object.fromEntries(
      Object.entries(stored).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
  );
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => focusAfter(firstRef.current), [question.id]);

  const done = items.filter((it) => shots[it.value]?.state === 'done').length;
  const total = items.length;
  const complete = total > 0 && done === total;

  const pick = (item: string, camera: boolean) => {
    pending.current = item;
    setError(null);
    (camera ? cameraRef : libraryRef).current?.click();
  };

  const upload = useCallback(
    async (item: string, file: File) => {
      const label = items.find((i) => i.value === item)?.label ?? 'Photo';
      if (!onFileUpload) {
        setShots((s) => ({ ...s, [item]: { state: 'error', error: 'Photos can’t be saved on this form.' } }));
        return;
      }
      if (file.size > PHOTO_MAX_BYTES * 3) {
        setShots((s) => ({ ...s, [item]: { state: 'error', error: 'That photo is too large.' } }));
        return;
      }
      const thumb = URL.createObjectURL(file);
      setShots((s) => ({ ...s, [item]: { state: 'uploading', thumb } }));
      setSaid(`${label}: uploading.`);
      try {
        const ref = await onFileUpload(file, question.id, { maxSizeMb: PHOTO_MAX_BYTES / MIB });
        if (!alive.current) return;
        thumbs.set(ref, thumb);
        answerRef.current = { ...answerRef.current, [item]: ref };
        onAnswer({ ...answerRef.current });
        ping?.();
        setShots((s) => ({ ...s, [item]: { state: 'done', thumb, ref } }));
        setSaid(`${label}: added.`);
      } catch (err) {
        if (!alive.current) return;
        setShots((s) => ({
          ...s,
          [item]: {
            state: 'error',
            thumb,
            error: err instanceof Error && err.message ? err.message : 'Couldn’t upload that photo.',
          },
        }));
        setSaid(`${label}: upload failed.`);
      }
    },
    [items, onFileUpload, question.id, onAnswer, ping],
  );

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const item = pending.current;
    e.target.value = '';
    pending.current = null;
    if (file && item) void upload(item, file);
  };

  const remove = (item: string) => {
    const next = { ...answerRef.current };
    delete next[item];
    answerRef.current = next;
    onAnswer(Object.keys(next).length ? next : undefined);
    setShots((s) => {
      const copy = { ...s };
      delete copy[item];
      return copy;
    });
  };

  const submit = useCallback(() => {
    if (Object.values(shots).some((s) => s.state === 'uploading')) {
      setError('Still uploading — one moment');
      return;
    }
    const answer = Object.keys(answerRef.current).length ? { ...answerRef.current } : undefined;
    const err = validate(question, answer);
    if (err) {
      setError(err.message);
      shakeInvalid(listRef.current);
      return;
    }
    setError(null);
    onAnswer(answer);
    onAdvance();
  }, [shots, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  return (
    <div>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div className={`slate-shots${complete ? ' slate-shots--complete' : ''}`}>
        <div className="slate-shots-progress" role="status">
          <svg className="slate-shots-ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
            <circle className="slate-shots-ring-track" cx="18" cy="18" r="15" pathLength={100} />
            <circle
              className="slate-shots-ring-fill"
              cx="18"
              cy="18"
              r="15"
              pathLength={100}
              style={{ '--slate-progress': total ? done / total : 0 } as CSSProperties}
            />
          </svg>
          <span className="slate-shots-count">
            {done} of {total} {total === 1 ? 'photo' : 'photos'}
          </span>
          {complete ? <span className="slate-shots-done">All set</span> : null}
        </div>

        <ol ref={listRef} className="slate-shots-list" aria-labelledby={titleId}>
          {items.map((it, i) => {
            const shot = shots[it.value];
            const state = shot?.state;
            return (
              <li
                key={it.value}
                className={`slate-shot${state ? ` slate-shot--${state}` : ''}`}
                style={{ '--slate-i': i } as CSSProperties}
              >
                <span className="slate-shot-thumb" aria-hidden="true">
                  {shot?.thumb ? <img src={shot.thumb} alt="" /> : <CameraIcon />}
                  {state === 'uploading' ? <span className="slate-shot-spin" /> : null}
                  {state === 'done' ? (
                    <svg className="slate-shot-check" viewBox="0 0 24 24" focusable="false">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </span>
                <span className="slate-shot-text">
                  <span className="slate-shot-label">{it.label}</span>
                  {it.description ? <span className="slate-shot-desc">{it.description}</span> : null}
                  {state === 'error' ? (
                    <span className="slate-shot-err" role="alert">
                      {shot?.error}
                    </span>
                  ) : state === 'uploading' ? (
                    <span className="slate-shot-desc">Uploading…</span>
                  ) : null}
                </span>
                <span className="slate-shot-actions">
                  <button
                    ref={i === 0 ? firstRef : undefined}
                    type="button"
                    className="slate-shot-btn"
                    disabled={state === 'uploading'}
                    aria-label={`${state === 'done' ? 'Retake' : 'Take'} photo: ${it.label}`}
                    onClick={() => pick(it.value, true)}
                  >
                    <CameraIcon />
                    <span className="slate-shot-btn-text">{state === 'done' ? 'Retake' : 'Take photo'}</span>
                  </button>
                  <button
                    type="button"
                    className="slate-shot-lib"
                    disabled={state === 'uploading'}
                    aria-label={`Choose a photo for ${it.label}`}
                    onClick={() => pick(it.value, false)}
                  >
                    <LibraryIcon />
                  </button>
                  {state === 'done' || state === 'error' ? (
                    <button
                      type="button"
                      className="slate-shot-remove"
                      aria-label={`Remove photo: ${it.label}`}
                      onClick={() => remove(it.value)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
                      </svg>
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>

        <input
          ref={cameraRef}
          className="slate-shots-input"
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
        <input
          ref={libraryRef}
          className="slate-shots-input"
          type="file"
          accept="image/*"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
      {error ? (
        <p className="slate-err" aria-live="polite">
          ! {error}
        </p>
      ) : null}
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint">press Enter ↵</span>
      </div>
    </div>
  );
}
