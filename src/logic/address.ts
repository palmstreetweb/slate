/**
 * Address answers and the service-area check (ADR-064) — pure, no React.
 *
 * An owner lists the ZIP codes (or ZIP prefixes) they serve. A condition can
 * then ask "is this address outside the area?" with `OUT_OF_AREA_VALUE`, the
 * way `OTHER_VALUE` asks "picked Other" (ADR-063): the sentinel is never
 * stored, only compared.
 */

import type { AddressQuestion, Question } from '@/types/Question.js';
import { formZipAreas, hasGeoArea, locationStatus } from './geo.js';

/** In a condition's value: the address's ZIP is inside the question's service area. */
export const IN_AREA_VALUE = '__in_area__';
/** In a condition's value: the address has a ZIP, and it is outside the service area. */
export const OUT_OF_AREA_VALUE = '__out_of_area__';

/** The parts of an address answer, in reading order. */
export const ADDRESS_PARTS = ['street', 'line2', 'city', 'region', 'postal', 'country'] as const;
export type AddressPart = (typeof ADDRESS_PARTS)[number];

/** Longest stored text per part, in characters (the server clamps to the same). */
export const ADDRESS_MAX: Record<AddressPart, number> = {
  street: 200,
  line2: 120,
  city: 100,
  region: 100,
  postal: 20,
  country: 80,
};

/** Most service-area entries a question keeps. */
export const SERVICE_AREA_MAX = 500;

/** Uppercase, without spaces or dashes: "v6b 1a1" → "V6B1A1", "93101-1234" → "931011234". */
export function normalizePostal(v: string): string {
  return v.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * The owner's list, cleaned: entries normalized, a trailing `*` dropped
 * ("931*" is the prefix "931"), blanks and duplicates removed.
 */
export function serviceAreaPrefixes(list: ReadonlyArray<unknown> | undefined): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const raw of list.slice(0, SERVICE_AREA_MAX)) {
    if (typeof raw !== 'string') continue;
    const p = normalizePostal(raw.replace(/\*+$/, ''));
    if (/^[A-Z0-9]{1,10}$/.test(p)) out.add(p);
  }
  return [...out];
}

/** Split a pasted list ("93101, 93103\n931*") into entries. */
export function parseServiceAreaText(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, SERVICE_AREA_MAX);
}

/** The postal code in an address answer, or '' when there is none. */
export function postalOf(answer: unknown): string {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return '';
  const p = (answer as { postal?: unknown }).postal;
  return typeof p === 'string' ? p.trim() : '';
}

/**
 * 'in' or 'out' for an answer against a service area, or null when there is
 * no area or no ZIP to check. Prefix match: "931" covers 93101–93199.
 */
export function areaStatus(answer: unknown, prefixes: ReadonlyArray<string>): 'in' | 'out' | null {
  if (prefixes.length === 0) return null;
  const postal = normalizePostal(postalOf(answer));
  if (!postal) return null;
  return prefixes.some((p) => postal.startsWith(p)) ? 'in' : 'out';
}

/**
 * Question id → how to tell whether its answer is inside the service area:
 * an address against its ZIP list (ADR-064), a location against its radius or,
 * typed as a ZIP, against the form's address ZIP lists (ADR-065).
 */
export type AreaIndex = ReadonlyMap<string, (answer: unknown) => 'in' | 'out' | null>;

const areaCache = new WeakMap<ReadonlyArray<Question>, AreaIndex>();

/** Service-area checks by question id, cached per questions array. */
export function areaIndex(questions: ReadonlyArray<Question>): AreaIndex {
  const hit = areaCache.get(questions);
  if (hit) return hit;
  const map = new Map<string, (answer: unknown) => 'in' | 'out' | null>();
  let zips: string[] | null = null;
  for (const q of questions) {
    if (q.type === 'address') {
      const prefixes = serviceAreaPrefixes(q.serviceArea);
      if (prefixes.length) map.set(q.id, (a) => areaStatus(a, prefixes));
    } else if (q.type === 'location') {
      zips ??= formZipAreas(questions);
      const z = zips;
      if (hasGeoArea(q) || z.length) {
        map.set(q.id, (a) => locationStatus(q as unknown as Record<string, unknown>, a, z));
      }
    }
  }
  areaCache.set(questions, map);
  return map;
}

/** True when this address question checks a service area. */
export function hasServiceArea(q: Question): q is AddressQuestion {
  return q.type === 'address' && serviceAreaPrefixes(q.serviceArea).length > 0;
}

/**
 * True when a condition can ask "inside / outside the service area" of this
 * question: an address with ZIP codes, or a location with a center and radius
 * (or, for a ZIP typed instead, a form whose addresses list ZIP codes).
 */
export function checksArea(q: Question, questions: ReadonlyArray<Question>): boolean {
  if (q.type === 'address') return hasServiceArea(q);
  if (q.type === 'location') return hasGeoArea(q) || formZipAreas(questions).length > 0;
  return false;
}

/** Address answer as one line: "12 Palm St, Apt 4, Santa Barbara, CA 93101". */
export function formatAddress(answer: unknown): string {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return '';
  const a = answer as Partial<Record<AddressPart, unknown>>;
  const s = (k: AddressPart) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  const regionZip = [s('region'), s('postal')].filter(Boolean).join(' ');
  return [s('street'), s('line2'), s('city'), regionZip, s('country')].filter(Boolean).join(', ');
}
