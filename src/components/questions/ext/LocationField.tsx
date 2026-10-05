/**
 * "Use my location" (ADR-065), loaded on demand. One tap asks the browser for
 * the respondent's position — never on load — and the answer carries it
 * rounded to 3 decimals (about 100 m), with whether it is inside the owner's
 * radius. The server recomputes that from the published form, so it can't be
 * forged, and conditions can route on it (`IN_AREA_VALUE` / `OUT_OF_AREA_VALUE`).
 * By default the server then keeps only the verdict (ADR-068).
 *
 * A small radar shows the answer: the service area is the ring, the business
 * the middle, the respondent a dot. The privacy line — the owner's note and
 * what is actually saved — is always on screen. When location is off or
 * unavailable: type a ZIP code (checked against the form's address service
 * areas) or, without any, the town.
 */

'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { LocationQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { OUT_OF_AREA_VALUE } from '@/logic/address.js';
import {
  PLACE_TYPED_MAX,
  formZipAreas,
  geoCenter,
  geoRadiusKm,
  locationAnswerCore,
} from '@/logic/geo.js';
import { formatDistance, locationDistance, locationPrivacyLine } from '@/logic/geoText.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { resolveTitle } from '../_resolveTitle.js';
import { FieldError } from './fieldMessage.js';
import '@/styles/extensions.css';
import '@/styles/extensions-c.css';

type Phase = 'idle' | 'locating' | 'done' | 'off' | 'manual';

/** A padlock, so the privacy line doesn't read as an empty checkbox to tick. */
function LockIcon() {
  return (
    <svg className="slate-loc-privacy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

/**
 * Where the respondent's dot sits on the radar, as a fraction of the radar's
 * half-width from its middle: the ring is 0.62; far away is pinned near the edge.
 */
function radarSpot(
  center: { lat: number; lng: number } | null,
  radiusKm: number | null,
  lat: number,
  lng: number,
): { x: number; y: number } {
  if (!center || !radiusKm) return { x: 0, y: 0 };
  const kmX = (lng - center.lng) * 111.32 * Math.cos((center.lat * Math.PI) / 180);
  const kmY = (lat - center.lat) * 110.57;
  const d = Math.hypot(kmX, kmY);
  if (d === 0) return { x: 0, y: 0 };
  const r = d / radiusKm;
  // Inside: clear of the business mark, then to scale. Outside: squeezed toward
  // the edge so it stays on the radar.
  const scaled = r <= 1 ? 0.2 + r * 0.42 : 0.62 + 0.3 * (1 - 1 / r);
  return { x: (kmX / d) * scaled, y: (-kmY / d) * scaled };
}

export default function LocationField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
  ping,
  allQuestions,
}: ExtFieldProps<LocationQuestion>) {
  const titleId = useId();
  const noteId = useId();
  // A ZIP typed instead is checked against the form's address service areas.
  const zips = useMemo(() => formZipAreas(allQuestions ?? []), [allQuestions]);
  const rec = question as unknown as Record<string, unknown>;
  const center = geoCenter(rec);
  const radius = geoRadiusKm(rec);
  const hasZipCheck = zips.length > 0;

  const seeded = locationAnswerCore(rec, value, zips);
  const [answer, setAnswer] = useState<Record<string, string> | undefined>(seeded);
  const [phase, setPhase] = useState<Phase>(seeded ? (seeded.lat ? 'done' : 'manual') : 'idle');
  const [offReason, setOffReason] = useState<'denied' | 'unavailable' | 'timeout'>('denied');
  const [text, setText] = useState(seeded?.zip ?? seeded?.typed ?? '');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  // Set on every mount: StrictMode (and a remount) runs the cleanup in between.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(
    () => focusAfter(phase === 'manual' || phase === 'off' ? inputRef.current : buttonRef.current),
    // Once per question, and when switching to typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question.id, phase === 'manual' || phase === 'off'],
  );

  const store = useCallback(
    (next: Record<string, string> | undefined) => {
      setAnswer(next);
      onAnswer(next);
    },
    [onAnswer],
  );

  const locate = () => {
    setError(null);
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo || (typeof window !== 'undefined' && window.isSecureContext === false)) {
      setOffReason('unavailable');
      setPhase('off');
      return;
    }
    setPhase('locating');
    setSaid('Finding your location…');
    geo.getCurrentPosition(
      (pos) => {
        if (!alive.current) return;
        const next = locationAnswerCore(
          rec,
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          zips,
        );
        if (!next) {
          setOffReason('unavailable');
          setPhase('off');
          return;
        }
        ping?.();
        store(next);
        setPhase('done');
        setSaid(
          next.area === 'in'
            ? 'Got it. You’re inside the service area.'
            : next.area === 'out'
              ? 'Got it. You’re outside the usual service area.'
              : 'Got it.',
        );
      },
      (err) => {
        if (!alive.current) return;
        setOffReason(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable');
        setPhase('off');
        setSaid('Location is off. You can type it instead.');
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  };

  const onManual = (raw: string) => {
    setText(raw);
    setError(null);
    const t = raw.trim();
    if (!t) {
      store(undefined);
      return;
    }
    // A ZIP when the form checks ZIP codes and it looks like one; otherwise the place as typed.
    const zipLike = /^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(t) && /\d/.test(t);
    store(locationAnswerCore(rec, hasZipCheck && zipLike ? { zip: t } : { typed: t }, zips));
  };

  const submit = useCallback(() => {
    if (phase === 'locating') {
      setError('Still finding your location…');
      return;
    }
    const err = validate(question, answer);
    if (err) {
      const typingNow = phase === 'manual' || phase === 'off';
      // Point at what is on screen: the box when typing, else the two ways in.
      setError(
        err.code !== 'required'
          ? err.message
          : typingNow
            ? hasZipCheck
              ? 'Please type your ZIP code'
              : 'Please type your town or ZIP code'
            : hasZipCheck
              ? 'Please share your location, or enter a ZIP code instead'
              : err.message,
      );
      shakeInvalid(typingNow ? inputRef.current : rootRef.current);
      return;
    }
    setError(null);
    onAnswer(answer);
    onAdvance();
  }, [phase, question, answer, hasZipCheck, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const lat = answer?.lat ? Number(answer.lat) : null;
  const lng = answer?.lng ? Number(answer.lng) : null;
  const spot = lat !== null && lng !== null ? radarSpot(center, radius, lat, lng) : null;
  const distance = locationDistance(rec, answer);
  const area = answer?.area;
  const typing = phase === 'manual' || phase === 'off';
  // When the owner routes people outside the area to their own ending, don't promise "continue".
  const routesOut = (question.logic ?? []).some((r) =>
    JSON.stringify(r.if).includes(OUT_OF_AREA_VALUE),
  );

  return (
    <div ref={rootRef}>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>

      <div
        className={`slate-loc slate-loc--${phase}${area ? ` slate-loc--${area}` : ''}`}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={error ? `${noteId} ${titleId}-err` : noteId}
      >
        <div className="slate-loc-radar" aria-hidden="true">
          <span className="slate-loc-ring slate-loc-ring--outer" />
          <span className="slate-loc-ring slate-loc-ring--area" />
          <span className="slate-loc-sweep" />
          <span className="slate-loc-home" />
          {spot ? (
            <span
              className="slate-loc-dot"
              style={{ '--slate-dx': spot.x, '--slate-dy': spot.y } as CSSProperties}
            />
          ) : null}
        </div>

        <div className="slate-loc-body">
          {phase === 'done' && answer ? (
            <p className="slate-loc-result" role="status">
              {area === 'in' ? (
                <>
                  <strong>You’re in our service area.</strong>
                  {distance !== null
                    ? ` About ${formatDistance(distance, question.radiusUnit)} away.`
                    : ''}
                </>
              ) : area === 'out' ? (
                <>
                  <strong>You’re outside our usual area.</strong>
                  {distance !== null
                    ? ` About ${formatDistance(distance, question.radiusUnit)} away.`
                    : ''}
                  {routesOut ? '' : ' You can still continue.'}
                </>
              ) : (
                <strong>Got your location.</strong>
              )}
            </p>
          ) : null}

          {phase === 'off' ? (
            <p className="slate-loc-result" role="status">
              {offReason === 'denied'
                ? 'Location is off for this page. No problem — '
                : offReason === 'timeout'
                  ? 'We couldn’t find you in time. No problem — '
                  : 'Location isn’t available here. No problem — '}
              {hasZipCheck ? 'type your ZIP code instead.' : 'type your town or ZIP code instead.'}
            </p>
          ) : null}

          {!typing ? (
            <button
              ref={buttonRef}
              type="button"
              className={`slate-loc-btn${phase === 'done' ? ' slate-loc-btn--again' : ''}`}
              onClick={locate}
              disabled={phase === 'locating'}
            >
              <PinIcon />
              {phase === 'locating'
                ? 'Finding you…'
                : phase === 'done'
                  ? 'Use my location again'
                  : 'Use my location'}
            </button>
          ) : (
            <label className="slate-part slate-loc-manual">
              <span className="slate-part-label">
                {hasZipCheck ? 'Your ZIP code' : 'Your town or ZIP code'}
              </span>
              <input
                ref={inputRef}
                className="slate-input"
                aria-describedby={`${titleId}-err`}
                value={text}
                maxLength={PLACE_TYPED_MAX}
                inputMode={hasZipCheck ? 'numeric' : 'text'}
                autoComplete={hasZipCheck ? 'postal-code' : 'address-level2'}
                enterKeyHint="done"
                placeholder={hasZipCheck ? '93101' : 'Santa Barbara'}
                onChange={(e) => onManual(e.target.value)}
                onKeyDown={(e) => {
                  if (isTypewriterKey(e)) onType?.();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {answer?.zip && answer.area ? (
                <span className={`slate-loc-zip slate-loc-zip--${answer.area}`} role="status">
                  {answer.area === 'in' ? 'In our service area' : 'Outside our usual area'}
                </span>
              ) : null}
            </label>
          )}

          {typing ? (
            <button type="button" className="slate-loc-link" onClick={locate}>
              Try my location again
            </button>
          ) : (
            <button
              type="button"
              className="slate-loc-link"
              onClick={() => {
                setPhase('manual');
                setError(null);
                if (answer?.lat) store(undefined);
              }}
            >
              {hasZipCheck ? 'Enter a ZIP code instead' : 'Type it instead'}
            </button>
          )}

          <p id={noteId} className="slate-loc-privacy">
            <LockIcon />
            <span>{locationPrivacyLine(question, typing, Boolean(center && radius) || hasZipCheck)}</span>
          </p>
        </div>
      </div>

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
      <FieldError id={`${titleId}-err`} error={error} />
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint slate-keys">press Enter ↵</span>
      </div>
    </div>
  );
}
