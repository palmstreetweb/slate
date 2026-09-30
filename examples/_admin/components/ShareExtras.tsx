/**
 * Share panel rows added in ADR-063, kept to one line each until opened so
 * the panel stays compact (standing decision: no scrolling Share modal).
 *
 *   - CloseRow: close on a date and time, or after N responses, with a
 *     message. Live the moment it's saved — the public lookup and the submit
 *     Function read it (migration 019) — so there's no Republish.
 *   - TrackedLinks: name a source ("Mailbox flyer"), get its own link and QR.
 *     The base link never changes; the source rides in `?src=`.
 */

'use client';

import { useState } from 'react';
import type { FormRecord, TrackedSource } from '../_formsStore.js';
import {
  CLOSED_MESSAGE_MAX,
  MAX_RESPONSES_LIMIT,
  closedReason,
  describeClose,
  isoToLocalInput,
  localInputToIso,
} from '../formClose.js';
import { addTrackedSource } from '../trackedLinks.js';

type ClosePatch = Pick<FormRecord, 'closesAt' | 'maxResponses' | 'closedMessage'>;

function ClockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CloseRow({
  form,
  liveResponses,
  onSave,
}: {
  form: FormRecord;
  liveResponses: number;
  /** Persist the close settings; resolves false when the save failed. */
  onSave: (patch: ClosePatch, toast: { title: string; detail: string }) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState('');
  const [cap, setCap] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reason = closedReason(form, liveResponses);

  const startEditing = () => {
    setWhen(isoToLocalInput(form.closesAt));
    setCap(form.maxResponses !== undefined ? String(form.maxResponses) : '');
    setMessage(form.closedMessage ?? '');
    setError(null);
    setEditing(true);
  };

  const save = () => {
    const closesAt = when ? localInputToIso(when) : undefined;
    if (when && !closesAt) return setError('Pick a date and time.');
    let maxResponses: number | undefined;
    if (cap.trim()) {
      const n = Number(cap);
      if (!Number.isInteger(n) || n < 1 || n > MAX_RESPONSES_LIMIT) {
        return setError(`Use a whole number from 1 to ${MAX_RESPONSES_LIMIT.toLocaleString()}.`);
      }
      maxResponses = n;
    }
    const closedMessage = message.trim().slice(0, CLOSED_MESSAGE_MAX) || undefined;
    const ok = onSave(
      { closesAt, maxResponses, closedMessage },
      closesAt || maxResponses
        ? { title: 'Closing set', detail: 'Live now — no need to republish.' }
        : { title: 'Always open', detail: 'The form takes responses until you close it.' },
    );
    if (ok) setEditing(false);
    else setError('Couldn’t save. Check your connection and try again.');
  };

  const closeNow = () => {
    onSave(
      {
        closesAt: new Date().toISOString(),
        maxResponses: form.maxResponses,
        closedMessage: form.closedMessage,
      },
      { title: 'Form closed', detail: 'People who open the link now see your closed message.' },
    );
  };

  const reopen = () => {
    onSave(
      {
        closesAt: reason === 'date' ? undefined : form.closesAt,
        maxResponses: reason === 'full' ? undefined : form.maxResponses,
        closedMessage: form.closedMessage,
      },
      { title: 'Reopened', detail: 'The form takes responses again.' },
    );
  };

  if (editing) {
    return (
      <section className="slate-share-close slate-share-close--editing" aria-label="Closing">
        <div className="slate-share-close-grid">
          <label className="slate-share-close-field">
            <span>Close on</span>
            <input
              className="slate-input"
              type="datetime-local"
              value={when}
              onChange={(e) => {
                setWhen(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label className="slate-share-close-field">
            <span>Or after</span>
            <span className="slate-share-close-cap">
              <input
                className="slate-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_RESPONSES_LIMIT}
                placeholder="—"
                value={cap}
                onChange={(e) => {
                  setCap(e.target.value);
                  setError(null);
                }}
              />
              <span>responses</span>
            </span>
          </label>
        </div>
        <label className="slate-share-close-field">
          <span>Message when closed (optional)</span>
          <textarea
            className="slate-textarea"
            rows={2}
            maxLength={CLOSED_MESSAGE_MAX}
            placeholder="e.g. All spots are taken — see you next summer!"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {error ? (
          <p className="slate-share-lock-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="slate-share-close-actions">
          <button
            type="button"
            className="slate-btn slate-btn--primary slate-btn--compact"
            onClick={save}
          >
            Save
          </button>
          <button type="button" className="slate-share-lock-link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="slate-share-close" aria-label="Closing">
      <div className="slate-share-lock-row">
        <span
          className={`slate-share-lock-label${reason ? ' slate-share-close-label--closed' : ''}`}
        >
          <ClockGlyph />
          {describeClose(form, liveResponses)}
        </span>
        <span className="slate-share-lock-actions">
          {reason ? (
            <button type="button" className="slate-share-lock-link" onClick={reopen}>
              Reopen
            </button>
          ) : (
            <button type="button" className="slate-share-lock-link" onClick={closeNow}>
              Close now
            </button>
          )}
          <button type="button" className="slate-share-lock-link" onClick={startEditing}>
            Schedule
          </button>
        </span>
      </div>
    </section>
  );
}

export function TrackedLinks({
  sources,
  selected,
  onSelect,
  onChange,
}: {
  sources: ReadonlyArray<TrackedSource>;
  /** The selected source's `src`, or null for the main link. */
  selected: string | null;
  onSelect: (src: string | null) => void;
  /** Persist a new list; resolves false when the save failed. */
  onChange: (next: TrackedSource[]) => boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const r = addTrackedSource(sources, name);
    if ('error' in r) return setError(r.error);
    if (r.list.length !== sources.length && !onChange(r.list)) {
      return setError('Couldn’t save. Check your connection and try again.');
    }
    onSelect(r.entry.src);
    setAdding(false);
    setName('');
    setError(null);
  };

  const remove = (src: string) => {
    if (onChange(sources.filter((s) => s.src !== src))) onSelect(null);
  };

  if (adding) {
    return (
      <section className="slate-share-track" aria-label="Tracked links">
        <form
          className="slate-share-lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            className="slate-input slate-share-lock-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Name a flyer, e.g. Mailbox flyer"
            aria-label="Name this link"
            maxLength={80}
            autoFocus
          />
          <button
            type="submit"
            className="slate-btn slate-btn--primary slate-btn--compact"
            disabled={!name.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="slate-share-lock-link"
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </form>
        {error ? (
          <p className="slate-share-lock-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="slate-share-track" aria-label="Tracked links">
      <div className="slate-share-track-chips" role="radiogroup" aria-label="Which link">
        <button
          type="button"
          role="radio"
          aria-checked={selected === null}
          className={`slate-share-track-chip${selected === null ? ' slate-share-track-chip--on' : ''}`}
          onClick={() => onSelect(null)}
        >
          Main link
        </button>
        {sources.map((s) => (
          <span key={s.src} className="slate-share-track-chip-wrap">
            <button
              type="button"
              role="radio"
              aria-checked={selected === s.src}
              className={`slate-share-track-chip${selected === s.src ? ' slate-share-track-chip--on' : ''}`}
              title={`?src=${s.src}`}
              onClick={() => onSelect(s.src)}
            >
              {s.name}
            </button>
            {selected === s.src ? (
              <button
                type="button"
                className="slate-share-track-remove"
                aria-label={`Remove ${s.name} from this list (printed links keep working)`}
                title="Remove from list — printed links keep working"
                onClick={() => remove(s.src)}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        <button
          type="button"
          className="slate-share-track-add"
          onClick={() => {
            setAdding(true);
            setName('');
          }}
        >
          + Track a flyer
        </button>
      </div>
    </section>
  );
}
