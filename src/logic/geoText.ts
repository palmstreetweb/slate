/**
 * Location wording for the field and Responses (ADR-065, ADR-068). Kept apart
 * from `geo.ts`, which the engine's conditions need up front, so this loads
 * only with the location field and the studio.
 */

import { KM_PER_MI, distanceKm, geoCenter, roundCoord } from './geo.js';

type GeoRecord = Record<string, unknown>;

/** What a location question saves, by default (ADR-068): the verdict only. */
export const LOCATION_SAVES_VERDICT = 'We only save whether you’re in the service area.';
/** While typing, without the opt-in: a typed place is kept as written (ADR-068). */
export const LOCATION_SAVES_TYPED = 'We save what you type here, not your exact location.';
/** What it saves when the owner keeps the approximate location (ADR-068). */
export const LOCATION_SAVES_APPROX =
  'Your approximate location (about 110 m) is shared with this business.';

/**
 * The privacy line under the button: the owner's own note, if any, then what
 * is actually saved — always shown, so no note can promise less than is kept.
 */
export function locationPrivacyLine(
  q: { privacyNote?: unknown; keepLocation?: unknown },
  typing = false,
): string {
  const note = typeof q.privacyNote === 'string' ? q.privacyNote.trim() : '';
  const saves =
    q.keepLocation === true
      ? LOCATION_SAVES_APPROX
      : typing
        ? LOCATION_SAVES_TYPED
        : LOCATION_SAVES_VERDICT;
  if (!note) return saves;
  return `${note}${/[.!?…]["”’)]?$/.test(note) ? '' : '.'} ${saves}`;
}

/** Distance from the center to a stored location, in the question's unit; null when unknown. */
export function locationDistance(q: GeoRecord, answer: unknown): number | null {
  const c = geoCenter(q);
  if (!c || answer === null || typeof answer !== 'object' || Array.isArray(answer)) return null;
  const a = answer as GeoRecord;
  const lat = roundCoord(a.lat, 90);
  const lng = roundCoord(a.lng, 180);
  if (lat === null || lng === null) return null;
  const km = distanceKm(c.lat, c.lng, Number(lat), Number(lng));
  return q.radiusUnit === 'km' ? km : km / KM_PER_MI;
}

/** "4.2 mi" / "12 km" — one decimal under 10. */
export function formatDistance(n: number, unit: unknown): string {
  const u = unit === 'km' ? 'km' : 'mi';
  const v = n < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  return `${v} ${u}`;
}
