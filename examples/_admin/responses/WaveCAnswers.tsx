/**
 * Wave C answers in Responses (ADR-065): pins drawn over the owner's photo,
 * a voice note you can play, a location with its distance and a small map of
 * the service area, a photo checklist item by item, and a painted week.
 * Respondent text renders as React text only; stored refs load through the
 * owner-only storage path, like every file answer.
 */

'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { Question } from '@/index.js';
import { imageKey, pinsOf } from '@/logic/pins.js';
import { geoCenter, geoRadiusKm } from '@/logic/geo.js';
import { formatClock, voiceAudioOf, voiceSecondsOf, voiceTypedOf } from '@/logic/media.js';
import {
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  availabilityGrid,
  clockLabel,
  decodeAvailability,
} from '@/logic/availability.js';
import { PIN_IMAGE_DATA_MAX, safeImageSrc } from '@/utils/brandLogo.js';
import { ResponseFileAnswer } from '../components/ResponseFileAnswer.js';
import { getLocalUploadBlob } from '../localFileStore.js';
import { getStorageContentBlob, isStorageUploadRef } from '../storageUpload.js';
import { isVerdictOnlyLocation, locationAreaOf, locationText } from '../responsesFormat.js';

type Q<T extends Question['type']> = Extract<Question, { type: T }>;

/** Pins over the photo they were placed on, numbered, with their notes. */
export function PinnedImage({ question, value }: { question: Q<'image_pin'>; value: unknown }) {
  const pins = pinsOf(value);
  const src = safeImageSrc(question.image, PIN_IMAGE_DATA_MAX);
  const placedOn = (value as { img?: unknown } | null)?.img;
  const moved =
    typeof placedOn === 'string' && placedOn !== '' && placedOn !== imageKey(question.image);
  return (
    <div className="rsp-pins">
      <div className="rsp-pins-photo">
        {src ? (
          <img src={src} alt={question.imageAlt ?? ''} referrerPolicy="no-referrer" />
        ) : (
          <span className="rsp-pins-blank" />
        )}
        {pins.map((p, i) => (
          <span
            key={i}
            className="rsp-pin"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` } as CSSProperties}
            aria-hidden="true"
          >
            {i + 1}
          </span>
        ))}
      </div>
      <ol className="rsp-pins-notes">
        {pins.map((p, i) => (
          <li key={i}>
            <span className="rsp-pins-n" aria-hidden="true">
              {i + 1}
            </span>
            <span dir="auto">{p.note.trim() || <span className="rsp-muted">No note</span>}</span>
            <span className="rsp-sr">{` at ${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}</span>
          </li>
        ))}
      </ol>
      {moved ? (
        <p className="rsp-muted rsp-pins-moved">
          Placed on an earlier photo — you’ve changed it since, so the spots may not line up.
        </p>
      ) : null}
    </div>
  );
}

/** Play a voice note. Loads the recording once, then a native player (seek, speed, download). */
export function VoiceNoteAnswer({ value }: { value: unknown }) {
  const typed = voiceTypedOf(value);
  const ref = voiceAudioOf(value);
  const sec = voiceSecondsOf(value);
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!ref) return undefined;
    let gone = false;
    let made: string | null = null;
    void (async () => {
      const blob = isStorageUploadRef(ref)
        ? ((await getStorageContentBlob(ref))?.blob ?? null)
        : await getLocalUploadBlob(ref);
      if (gone) return;
      if (!blob) {
        setProblem('The recording didn’t load. Use Download below.');
        return;
      }
      const type = (blob.type || '').split(';')[0]!;
      const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
      if (type && probe && probe.canPlayType(type) === '') {
        setProblem(
          'This browser can’t play this recording (it was made in another browser). Use Download below.',
        );
        return;
      }
      made = URL.createObjectURL(blob);
      setUrl(made);
    })().catch((err: unknown) => {
      // A dropped connection says so instead of "Loading the recording…" forever (audit B6).
      console.warn('[slate] voice note failed', err);
      if (!gone) setProblem('The recording didn’t load. Use Download below.');
    });
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [ref]);

  if (typed) {
    return (
      <p className="rsp-answer-v slate-selectable">
        <span className="rsp-muted">Typed instead: </span>
        {typed}
      </p>
    );
  }
  if (!ref) return <p className="rsp-answer-v">—</p>;
  return (
    <div className="rsp-voice">
      <div className="rsp-voice-player">
        {url ? (
          <audio controls preload="metadata" src={url} className="rsp-voice-audio" />
        ) : (
          <span className="rsp-muted">{problem ?? 'Loading the recording…'}</span>
        )}
        {sec !== null ? <span className="rsp-voice-len">{formatClock(sec)}</span> : null}
      </div>
      <ResponseFileAnswer value={ref} />
    </div>
  );
}

/**
 * Where the respondent is, in words and on a small map of the service area.
 * By default only the verdict is stored (ADR-068): the map shows the area
 * lit in or out, with no dot and no map link, and says the place wasn't kept.
 */
export function LocationAnswer({
  question,
  value,
  form,
}: {
  question: Q<'location'>;
  value: unknown;
  form: ReadonlyArray<Question>;
}) {
  const text = locationText(question, value, form);
  const v = (value ?? {}) as Record<string, unknown>;
  const lat = typeof v.lat === 'string' ? Number(v.lat) : null;
  const lng = typeof v.lng === 'string' ? Number(v.lng) : null;
  const area = locationAreaOf(question, value, form);
  const c = geoCenter(question as unknown as Record<string, unknown>);
  const r = geoRadiusKm(question as unknown as Record<string, unknown>);
  let dot: { x: number; y: number } | null = null;
  if (c && r && lat !== null && lng !== null) {
    const kx = (lng - c.lng) * 111.32 * Math.cos((c.lat * Math.PI) / 180);
    const ky = (lat - c.lat) * 110.57;
    const d = Math.hypot(kx, ky);
    const scaled = d === 0 ? 0 : d / r <= 1 ? (d / r) * 30 : 30 + 16 * (1 - r / d);
    dot = d === 0 ? { x: 0, y: 0 } : { x: (kx / d) * scaled, y: (-ky / d) * scaled };
  }
  return (
    <div className="rsp-loc">
      {c && r ? (
        <svg
          className={`rsp-loc-map${area ? ` rsp-loc-map--${area}` : ''}${
            isVerdictOnlyLocation(value) ? ' rsp-loc-map--verdict' : ''
          }`}
          viewBox="-50 -50 100 100"
          aria-hidden="true"
        >
          <circle r="46" className="rsp-loc-outer" />
          <circle r="30" className="rsp-loc-area" />
          <rect
            x="-3"
            y="-3"
            width="6"
            height="6"
            transform="rotate(45)"
            className="rsp-loc-home"
          />
          {dot ? <circle cx={dot.x} cy={dot.y} r="5" className="rsp-loc-dot" /> : null}
        </svg>
      ) : null}
      <div className="rsp-loc-text">
        <p className="rsp-answer-v slate-selectable">{text}</p>
        {lat !== null && lng !== null ? (
          <a
            className="rsp-textbtn"
            href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in a map
          </a>
        ) : isVerdictOnlyLocation(value) ? (
          <p className="rsp-muted rsp-loc-note">
            Only whether they’re in the area is saved, not where they are.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Each shot, with its photo (preview and download) or a gap. */
export function PhotoChecklistAnswer({
  question,
  value,
}: {
  question: Q<'photo_checklist'>;
  value: unknown;
}) {
  const a =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const done = question.items.filter(
    (i) => typeof a[i.value] === 'string' && a[i.value] !== '',
  ).length;
  return (
    <div className="rsp-shots">
      <p className="rsp-muted rsp-shots-count">
        {done} of {question.items.length} photos
      </p>
      <ul className="rsp-shots-list">
        {question.items.map((item) => {
          const ref = typeof a[item.value] === 'string' ? (a[item.value] as string) : '';
          return (
            <li key={item.value} className={`rsp-shot${ref ? '' : ' rsp-shot--missing'}`}>
              <span className="rsp-shot-label">{item.label}</span>
              {ref ? (
                <ResponseFileAnswer value={ref} />
              ) : (
                <span className="rsp-muted">No photo</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The painted week, read-only, with the times in words beside it. */
export function AvailabilityAnswer({
  question,
  value,
  text,
}: {
  question: Q<'availability'>;
  value: unknown;
  text: string;
}) {
  const grid = availabilityGrid(question as unknown as Record<string, unknown>);
  const picked = decodeAvailability(grid, value);
  const every = grid.slot >= 60 ? 1 : 60 / grid.slot;
  return (
    <div className="rsp-week">
      <div
        className="rsp-week-grid"
        style={{ '--rsp-days': grid.days.length } as CSSProperties}
        role="img"
        aria-label={`Free: ${text}`}
      >
        <span />
        {grid.days.map((d) => (
          <span key={d} className="rsp-week-day">
            {WEEKDAY_SHORT[d] ?? d}
          </span>
        ))}
        {Array.from({ length: grid.count }, (_, s) => (
          <div key={s} className="rsp-week-row">
            <span className="rsp-week-time">
              {s % every === 0 ? clockLabel(grid.start + s * grid.slot) : ''}
            </span>
            {grid.days.map((d) => (
              <span
                key={d}
                className={`rsp-week-cell${picked.get(d)?.has(s) ? ' is-on' : ''}`}
                title={`${WEEKDAY_LONG[d] ?? d} ${clockLabel(grid.start + s * grid.slot)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="rsp-answer-v slate-selectable rsp-week-text">{text.replace(/; /g, '\n')}</p>
    </div>
  );
}
