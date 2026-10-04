/**
 * Location answers, server side (ADR-065). The submit Function re-runs
 * `locationAnswerCore` on what the page sent, against the PUBLISHED center
 * and radius (and the published address ZIP lists for a ZIP typed instead),
 * so a stored `area` is always the server's own — a client can't claim to be
 * inside the service area. Coordinates are re-rounded to 3 decimals.
 *
 * Then `locationStoredCore` (ADR-068) keeps only `{ area?, via }` unless the
 * published question has `keepLocation: true`: by default the coordinates,
 * the ZIP and the typed place are used for the check and never stored.
 *
 * The section below is a byte-for-byte copy of the shared section of
 * src/logic/geo.ts. tests/geo.test.ts fails if the two drift.
 */

/* ---------- shared with the server (keep identical) ---------- */

/** Decimals kept on stored coordinates: 3 is about 110 m of latitude. */
export const GEO_DECIMALS = 3;
/** Kilometres in a statute mile. */
export const KM_PER_MI = 1.609344;
/** The largest radius the check honours, in km. */
export const RADIUS_KM_MAX = 1000;
/** Longest typed place ("Goleta, near the pier"), in characters. */
export const PLACE_TYPED_MAX = 100;
/** Most ZIP prefixes read from one address question (ADR-064's cap). */
const ZIP_AREA_MAX = 500;

type GeoRecord = Record<string, unknown>;

function isGeoRecord(v: unknown): v is GeoRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function coordNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d{1,3}(\.\d{1,12})?$/.test(v)) return Number(v);
  return Number.NaN;
}

/** A coordinate rounded to 3 decimals, as text ("34.420"), or null when it isn't one. */
export function roundCoord(v: unknown, limit: number): string | null {
  const n = coordNumber(v);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  const r = Math.round(n * 1000) / 1000;
  return (r === 0 ? 0 : r).toFixed(GEO_DECIMALS);
}

/** Great-circle distance in km (haversine, mean Earth radius). */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The question's center when it is a real coordinate, else null. */
export function geoCenter(q: GeoRecord): { lat: number; lng: number } | null {
  const c = q.center;
  if (!isGeoRecord(c)) return null;
  const { lat, lng } = c;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** The radius in km, or null when unset or not a positive number. */
export function geoRadiusKm(q: GeoRecord): number | null {
  const r = q.radius;
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) return null;
  return Math.min(q.radiusUnit === 'km' ? r : r * KM_PER_MI, RADIUS_KM_MAX);
}

/** ZIP rule of address service areas (ADR-064): uppercase, no spaces or dashes. */
function zipKey(v: string): string {
  return v.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Every ZIP prefix the form's address questions serve ("931*" is "931"), for
 * checking a ZIP typed on a location question. Empty when none lists any.
 */
export function formZipAreas(questions: unknown): string[] {
  const out = new Set<string>();
  if (!Array.isArray(questions)) return [];
  for (const q of questions) {
    if (!isGeoRecord(q) || q.type !== 'address' || !Array.isArray(q.serviceArea)) continue;
    for (const raw of q.serviceArea.slice(0, ZIP_AREA_MAX)) {
      if (typeof raw !== 'string') continue;
      const p = zipKey(raw.replace(/\*+$/, ''));
      if (/^[A-Z0-9]{1,10}$/.test(p)) out.add(p);
    }
  }
  return [...out];
}

/**
 * The location answer to store, from what the page sent:
 *   - `{ lat, lng, area? }`: coordinates rounded to 3 decimals; `area` is 'in'
 *     or 'out' of the question's radius when it has a center and a radius;
 *   - `{ zip, area? }`: a ZIP typed instead, checked against `zipAreas`;
 *   - `{ typed }`: a place typed instead, capped.
 * Anything else is undefined. A client `area` is never read, only recomputed.
 */
export function locationAnswerCore(
  q: GeoRecord,
  v: unknown,
  zipAreas: ReadonlyArray<string>,
): Record<string, string> | undefined {
  if (!isGeoRecord(v)) return undefined;
  const lat = roundCoord(v.lat, 90);
  const lng = roundCoord(v.lng, 180);
  if (lat !== null && lng !== null) {
    const c = geoCenter(q);
    const r = geoRadiusKm(q);
    if (!c || r === null) return { lat, lng };
    const km = distanceKm(c.lat, c.lng, Number(lat), Number(lng));
    return { lat, lng, area: km <= r ? 'in' : 'out' };
  }
  if (typeof v.zip === 'string') {
    const zip = zipKey(v.zip);
    if (!/^[A-Z0-9]{3,10}$/.test(zip)) return undefined;
    if (zipAreas.length === 0) return { zip };
    return { zip, area: zipAreas.some((p) => zip.startsWith(p)) ? 'in' : 'out' };
  }
  if (typeof v.typed === 'string') {
    const t = v.typed.trim().slice(0, PLACE_TYPED_MAX);
    return t ? { typed: t } : undefined;
  }
  return undefined;
}

/**
 * The location answer to STORE (ADR-068). The page still sends what it found
 * (rounded coordinates, a ZIP or a place) so the verdict can be re-checked
 * here; then, unless the owner turned on `keepLocation` (only `true` counts;
 * a schema without it is verdict-only), only the verdict and how it was
 * given are kept: `{ area?, via: 'gps' | 'zip' | 'typed' }`. No coordinates,
 * no distance (a distance to the one published center draws a circle) and no
 * ZIP. A place typed as words (no ZIP check) is kept as written: `{ typed }`. A verdict sent without the position it came from
 * is nothing (`locationAnswerCore` never reads a client `area`).
 */
export function locationStoredCore(
  q: GeoRecord,
  v: unknown,
  zipAreas: ReadonlyArray<string>,
): Record<string, string> | undefined {
  const a = locationAnswerCore(q, v, zipAreas);
  if (!a || q.keepLocation === true) return a;
  // A place they typed themselves (not a ZIP we can check) is kept as written:
  // it's what they chose to share, and without it the owner learns nothing.
  if (a.typed) return { typed: a.typed };
  const via = a.lat ? 'gps' : a.zip ? 'zip' : 'typed';
  return a.area ? { area: a.area, via } : { via };
}
