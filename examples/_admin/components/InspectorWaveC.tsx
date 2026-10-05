/**
 * Inspector sections for Wave C (ADR-065): the swipe style on picture choice
 * and yes / no, the pin-the-spot photo, the voice note, location and its
 * service-area radius, and the availability grid. (The photo checklist's
 * shots use the Inspector's own options editor.)
 */

import { useEffect, useRef, useState } from 'react';
import type {
  AvailabilityQuestion,
  ImagePinQuestion,
  LocationQuestion,
  PictureChoiceQuestion,
  Question,
  VoiceNoteQuestion,
  Weekday,
  YesNoQuestion,
} from '@/index.js';
import { PINS_MAX } from '@/logic/pins.js';
import {
  LOCATION_SAVES_APPROX,
  LOCATION_SAVES_SHARED,
  LOCATION_SAVES_VERDICT,
} from '@/logic/geoText.js';
import { formZipAreas, hasGeoArea } from '@/logic/geo.js';
import {
  VOICE_SECONDS_MAX,
  VOICE_SECONDS_MIN,
  formatClock,
  voiceMaxSeconds,
} from '@/logic/media.js';
import { WEEKDAY_KEYS, WEEKDAY_SHORT, availabilityGrid, clockLabel } from '@/logic/availability.js';
import { PIN_IMAGE_DATA_MAX, safeImageSrc } from '@/utils/brandLogo.js';
import { dataUrlKb, pinImageFromFile } from '../pinImage.js';
import { SlateNumberInput } from './SlateNumberInput.js';
import { SlateSelect } from './SlateSelect.js';
import { Checkbox, CollapsibleSection, Field, Row } from './inspectorParts.js';

type Patch = (patch: Partial<Question>) => void;

/** Picture choice: grid or swipe cards. Swipe turns on multi-select and leaves "Other" out. */
export function PictureStyleSetting({
  question,
  onChange,
}: {
  question: PictureChoiceQuestion;
  onChange: Patch;
}) {
  const swipe = question.display === 'swipe';
  return (
    <Field
      label="Style"
      hint={
        swipe
          ? 'One card at a time: swipe right to like, left to pass (or tap ✕ / ♥, or use ← →). The answer is the list of cards they liked.'
          : undefined
      }
    >
      <SlateSelect
        value={swipe ? 'swipe' : 'grid'}
        options={[
          { value: 'grid', label: 'Grid' },
          { value: 'swipe', label: 'Swipe cards' },
        ]}
        aria-label="Picture choice style"
        onChange={(display) =>
          onChange(
            (display === 'swipe'
              ? { display: 'swipe', multiple: true, allowOther: undefined, otherLabel: undefined }
              : { display: undefined }) as Partial<Question>,
          )
        }
      />
    </Field>
  );
}

/** Yes / no: two buttons or one swipe card. */
export function YesNoStyleSetting({
  question,
  onChange,
}: {
  question: YesNoQuestion;
  onChange: Patch;
}) {
  const swipe = question.display === 'swipe';
  return (
    <Field
      label="Style"
      hint={
        swipe
          ? 'The question sits on a card: right is yes, left is no. Y / N and the buttons work too.'
          : undefined
      }
    >
      <SlateSelect
        value={swipe ? 'swipe' : 'buttons'}
        options={[
          { value: 'buttons', label: 'Buttons' },
          { value: 'swipe', label: 'Swipe card (this or that)' },
        ]}
        aria-label="Yes / no style"
        onChange={(display) =>
          onChange({ display: display === 'swipe' ? 'swipe' : undefined } as Partial<Question>)
        }
      />
    </Field>
  );
}

/** Pin the spot: the photo (upload or link), how many pins, notes. */
export function ImagePinSettings({
  question,
  onChange,
}: {
  question: ImagePinQuestion;
  onChange: Patch;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isData = (question.image ?? '').startsWith('data:');
  const [link, setLink] = useState(isData ? '' : (question.image ?? ''));
  useEffect(() => {
    setLink((question.image ?? '').startsWith('data:') ? '' : (question.image ?? ''));
    setError(null);
  }, [question.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = safeImageSrc(question.image, PIN_IMAGE_DATA_MAX);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const url = await pinImageFromFile(file);
      setLink('');
      onChange({ image: url } as Partial<Question>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="slate-insp-photo">
        {src ? (
          <img className="slate-insp-photo-img" src={src} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="slate-insp-photo-empty">
            No photo yet — respondents see a blank grid.
          </span>
        )}
        <div className="slate-insp-photo-actions">
          <button
            type="button"
            className="slate-btn slate-btn--compact"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Preparing…' : src ? 'Replace photo' : 'Upload a photo'}
          </button>
          {src ? (
            <button
              type="button"
              className="slate-btn slate-btn--ghost slate-btn--compact"
              onClick={() => {
                setLink('');
                onChange({ image: undefined } as Partial<Question>);
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>
      {error ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          {error}
        </p>
      ) : (
        <p className="slate-help">
          {isData
            ? `Saved with the form (about ${dataUrlKb(question.image)} KB), so it loads with the first screen. Anyone with the link can see it.`
            : 'A house, a roof, a car — whatever they should mark. Uploads are resized to load fast on phones.'}
        </p>
      )}
      <Field label="Or paste a link to a photo" hint="A link that starts with https://">
        <input
          className="slate-input"
          value={link}
          placeholder="https://example.com/house.jpg"
          onChange={(e) => {
            setLink(e.target.value);
            onChange({ image: e.target.value.trim() || undefined } as Partial<Question>);
          }}
        />
      </Field>
      <Field label="Describe the photo (for screen readers)">
        <input
          className="slate-input"
          value={question.imageAlt ?? ''}
          maxLength={200}
          placeholder="Front of the house"
          onChange={(e) => onChange({ imageAlt: e.target.value || undefined } as Partial<Question>)}
        />
      </Field>
      <Field label="Most pins">
        <SlateNumberInput
          min={1}
          max={PINS_MAX}
          integer
          value={question.maxPins ?? 3}
          allowEmpty={false}
          onChange={(n) => onChange({ maxPins: n } as Partial<Question>)}
        />
      </Field>
      <Checkbox
        checked={Boolean(question.required)}
        onChange={(v) => onChange({ required: v } as Partial<Question>)}
        label="Required (at least one pin)"
      />
      <Checkbox
        checked={question.notes !== false}
        onChange={(v) => onChange({ notes: v ? undefined : false } as Partial<Question>)}
        label="Ask for a Short Note on Each Pin"
      />
    </>
  );
}

/** Voice note: what to talk about, how long, and typing instead. */
export function VoiceNoteSettings({
  question,
  onChange,
}: {
  question: VoiceNoteQuestion;
  onChange: Patch;
}) {
  return (
    <>
      <Field label="What to Talk About (Optional)" hint="Shown under the title.">
        <textarea
          className="slate-textarea"
          rows={2}
          value={question.body ?? ''}
          onChange={(e) => onChange({ body: e.target.value || undefined } as Partial<Question>)}
        />
      </Field>
      <Field
        label="Longest Recording (Seconds)"
        hint={`${formatClock(voiceMaxSeconds(question))} — it stops by itself. A minute is about 0.5–2.5 MB.`}
      >
        <SlateNumberInput
          min={VOICE_SECONDS_MIN}
          max={VOICE_SECONDS_MAX}
          step={15}
          integer
          value={question.maxSeconds ?? 60}
          allowEmpty={false}
          onChange={(n) => onChange({ maxSeconds: n } as Partial<Question>)}
        />
      </Field>
      <Checkbox
        checked={Boolean(question.required)}
        onChange={(v) => onChange({ required: v } as Partial<Question>)}
        label="Required"
      />
      <Checkbox
        checked={question.allowTyped !== false}
        onChange={(v) => onChange({ allowTyped: v ? undefined : false } as Partial<Question>)}
        label="Let Them Type Instead"
      />
      {question.allowTyped === false ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          Without typing, anyone whose microphone is blocked or missing can’t answer
          {question.required ? ' — and this question is required' : ''}.
        </p>
      ) : (
        <p className="slate-help">For a blocked microphone, an old browser, or a quiet office.</p>
      )}
    </>
  );
}

/** "34.42, -119.69" (or with a space, or from a maps link) → a center. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = /(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

/**
 * Location: the business location, the radius, what is kept (ADR-068: only in / out of the
 * area unless the owner keeps the approximate location), the privacy line, and an
 * out-of-area ending.
 */
export function LocationSettings({
  question,
  onChange,
  onAddOutOfAreaEnding,
  hasOutOfAreaRoute,
  form = [],
}: {
  question: LocationQuestion;
  onChange: Patch;
  onAddOutOfAreaEnding?: () => void;
  hasOutOfAreaRoute: boolean;
  /** Every question: a ZIP typed instead is checked against the address questions' lists. */
  form?: ReadonlyArray<Question>;
}) {
  const fmt = (c: LocationQuestion['center']) => (c ? `${c.lat}, ${c.lng}` : '');
  const [text, setText] = useState(fmt(question.center));
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setText(fmt(question.center));
    setNote(null);
  }, [question.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = text.trim() ? parseLatLng(text) : null;
  const ready =
    Boolean(question.center) && typeof question.radius === 'number' && question.radius > 0;
  const keep = question.keepLocation === true;
  // Verdict-only with nothing to check against stores little more than "they answered".
  const checkable = hasGeoArea(question) || formZipAreas(form).length > 0;

  const useMine = () => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setNote('This browser can’t share its location. Paste the coordinates instead.');
      return;
    }
    setLocating(true);
    setNote(null);
    geo.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const c = {
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lng: Math.round(pos.coords.longitude * 1e4) / 1e4,
        };
        setText(fmt(c));
        onChange({ center: c } as Partial<Question>);
      },
      () => {
        setLocating(false);
        setNote('Location is blocked for the studio. Paste the coordinates instead.');
      },
      { enableHighAccuracy: false, timeout: 15_000 },
    );
  };

  return (
    <>
      <Checkbox
        checked={Boolean(question.required)}
        onChange={(v) => onChange({ required: v } as Partial<Question>)}
        label="Required"
      />
      <CollapsibleSection
        label="Service area"
        hint="A circle around your business. Respondents see whether they’re inside it; Responses and endings can use it."
        summary={
          ready
            ? `${question.radius} ${question.radiusUnit === 'km' ? 'km' : 'mi'}`
            : question.center
              ? 'Needs a radius'
              : 'Not set'
        }
        defaultOpen
        questionId={question.id}
      >
        <Field
          label="Business location (latitude, longitude)"
          hint={
            text.trim() && !parsed
              ? 'Paste two numbers like 34.4208, -119.6982 (from any maps app).'
              : 'Anyone with the form link can see this point. Use your shop or the middle of the area you serve — not your home.'
          }
        >
          <input
            className="slate-input"
            value={text}
            placeholder="34.4208, -119.6982"
            spellCheck={false}
            aria-invalid={text.trim() && !parsed ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              const c = parseLatLng(e.target.value);
              if (c || !e.target.value.trim()) {
                onChange({ center: c ?? undefined } as Partial<Question>);
              }
            }}
          />
        </Field>
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--compact"
          onClick={useMine}
          disabled={locating}
        >
          {locating ? 'Finding you…' : 'Use my current location'}
        </button>
        {note ? (
          <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
            {note}
          </p>
        ) : null}
        <Row>
          <Field label="Radius">
            <SlateNumberInput
              min={0.5}
              max={1000}
              step={5}
              value={question.radius}
              placeholder="25"
              onChange={(n) => onChange({ radius: n } as Partial<Question>)}
            />
          </Field>
          <Field label="Unit">
            <SlateSelect
              value={question.radiusUnit === 'km' ? 'km' : 'mi'}
              options={[
                { value: 'mi', label: 'Miles' },
                { value: 'km', label: 'Kilometres' },
              ]}
              aria-label="Radius unit"
              onChange={(u) =>
                onChange({ radiusUnit: u === 'km' ? 'km' : 'mi' } as Partial<Question>)
              }
            />
          </Field>
        </Row>
        {ready && onAddOutOfAreaEnding ? (
          hasOutOfAreaRoute ? (
            <p className="slate-help">An ending already catches people outside the area.</p>
          ) : (
            <button
              type="button"
              className="slate-btn slate-btn--ghost slate-btn--compact"
              onClick={onAddOutOfAreaEnding}
            >
              <span className="slate-btn-plus">+</span> Add an “out of area” ending
            </button>
          )
        ) : null}
      </CollapsibleSection>
      <Checkbox
        checked={keep}
        onChange={(v) => onChange({ keepLocation: v ? true : undefined } as Partial<Question>)}
        label="Keep Approximate Location (About 110 m)"
      />
      <p className="slate-help">
        {keep
          ? 'Responses get the rounded coordinates (or the ZIP or town typed) and a map link. Respondents are told it’s shared with you.'
          : 'Off: Responses only say inside or outside the area, and whether it was checked with their location or a ZIP. A town they type is kept as written; where they are isn’t saved.'}
      </p>
      {!keep && !checkable ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          With no service area there’s nothing to check, so only “shared their location” is saved.
          Set a service area above, or keep the approximate location.
        </p>
      ) : null}
      <Field
        label="Privacy line"
        hint={`Optional: say what you use it for. Always followed by “${keep ? LOCATION_SAVES_APPROX : checkable ? LOCATION_SAVES_VERDICT : LOCATION_SAVES_SHARED}”`}
      >
        <textarea
          className="slate-textarea"
          rows={2}
          maxLength={300}
          value={question.privacyNote ?? ''}
          placeholder="We use this to plan the visit."
          onChange={(e) =>
            onChange({ privacyNote: e.target.value || undefined } as Partial<Question>)
          }
        />
      </Field>
      <p className="slate-help">
        If location is off, they can type a ZIP code (checked against any address question’s ZIP
        list) or their town.
      </p>
    </>
  );
}

const TIMES = Array.from({ length: 49 }, (_, i) => i * 30).map((m) => ({
  value: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
  label: m === 1440 ? 'Midnight (end)' : clockLabel(m),
}));

/** Availability: days, hours and slot length. */
export function AvailabilitySettings({
  question,
  onChange,
}: {
  question: AvailabilityQuestion;
  onChange: Patch;
}) {
  const grid = availabilityGrid(question as unknown as Record<string, unknown>);
  const days = new Set<string>(grid.days);
  const toggle = (d: Weekday) => {
    const next = WEEKDAY_KEYS.filter((k) => (k === d ? !days.has(k) : days.has(k)));
    if (next.length === 0) return;
    onChange({ days: next } as Partial<Question>);
  };
  const start = question.startTime ?? '08:00';
  const end = question.endTime ?? '18:00';
  return (
    <>
      <div className="slate-inspector-field">
        <span className="slate-label" id={`${question.id}-days`}>
          Days
        </span>
        <span className="slate-insp-days" role="group" aria-label="Days on the grid">
          {WEEKDAY_KEYS.map((d) => (
            <button
              key={d}
              type="button"
              className={`slate-insp-day${days.has(d) ? ' is-on' : ''}`}
              aria-pressed={days.has(d)}
              onClick={() => toggle(d)}
            >
              {WEEKDAY_SHORT[d]}
            </button>
          ))}
        </span>
      </div>
      <Row>
        <Field label="From">
          <SlateSelect
            value={start}
            options={
              TIMES.slice(0, -1).some((t) => t.value === start)
                ? TIMES.slice(0, -1)
                : [...TIMES, { value: start, label: start }]
            }
            aria-label="First time on the grid"
            onChange={(v) => onChange({ startTime: v } as Partial<Question>)}
          />
        </Field>
        <Field label="Until">
          <SlateSelect
            value={end}
            options={
              TIMES.slice(1).some((t) => t.value === end)
                ? TIMES.slice(1)
                : [...TIMES, { value: end, label: end }]
            }
            aria-label="Last time on the grid"
            onChange={(v) => onChange({ endTime: v } as Partial<Question>)}
          />
        </Field>
      </Row>
      <Field
        label="Each Slot"
        hint={`${grid.count} ${grid.count === 1 ? 'row' : 'rows'} × ${grid.days.length} ${grid.days.length === 1 ? 'day' : 'days'}. Phones read best at 16 rows or fewer.`}
      >
        <SlateSelect
          value={String(question.slotMinutes ?? 60)}
          options={[
            { value: '15', label: '15 minutes' },
            { value: '30', label: '30 minutes' },
            { value: '60', label: '1 hour' },
            { value: '120', label: '2 hours' },
          ]}
          aria-label="Slot length"
          onChange={(v) => onChange({ slotMinutes: Number(v) } as Partial<Question>)}
        />
      </Field>
      {(clockMinutesOrNull(end) ?? 0) <= (clockMinutesOrNull(start) ?? 0) ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          “Until” has to be after “From”.
        </p>
      ) : null}
      <Checkbox
        checked={Boolean(question.required)}
        onChange={(v) => onChange({ required: v } as Partial<Question>)}
        label="Required (at least one time)"
      />
      <p className="slate-help">Summary shows a heatmap of when most people are free.</p>
    </>
  );
}

function clockMinutesOrNull(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
