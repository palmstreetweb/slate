/**
 * Location wording for the field and Responses (ADR-065). Kept apart from
 * `geo.ts`, which the engine's conditions need up front, so this loads only
 * with the location field and the studio.
 */

import { KM_PER_MI, distanceKm, geoCenter, roundCoord } from './geo.js';

type GeoRecord = Record<string, unknown>;

/** The default privacy line on a location question. */
export const LOCATION_PRIVACY_DEFAULT =
  'We only use this to check that you’re in our service area. It’s saved rounded to about 100 m.';

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
