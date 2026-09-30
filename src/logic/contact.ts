/**
 * Contact block and address answers, part by part (ADR-064) — pure, no React.
 * The fields show one message per part; `validate()` reports the first.
 */

import type {
  AddressQuestion,
  ContactField,
  ContactFieldMode,
  ContactInfoQuestion,
} from '@/types/Question.js';
import { ADDRESS_MAX, type AddressPart } from './address.js';

/** The contact parts, in the order they're asked. */
export const CONTACT_FIELDS: ReadonlyArray<ContactField> = ['name', 'email', 'phone'];

/** Longest stored text per contact part (the server clamps to the same). */
export const CONTACT_MAX: Record<ContactField, number> = { name: 120, email: 254, phone: 40 };

const DEFAULT_MODE: Record<ContactField, ContactFieldMode> = {
  name: 'required',
  email: 'required',
  phone: 'optional',
};

/** RFC-lite, the same check as the email question. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How one part of a contact block is asked. */
export function contactMode(
  q: Pick<ContactInfoQuestion, 'fields'>,
  f: ContactField,
): ContactFieldMode {
  const m = q.fields?.[f];
  return m === 'off' || m === 'optional' || m === 'required' ? m : DEFAULT_MODE[f];
}

/** The parts that show, in order. */
export function contactShown(q: Pick<ContactInfoQuestion, 'fields'>): ContactField[] {
  return CONTACT_FIELDS.filter((f) => contactMode(q, f) !== 'off');
}

function text(answer: unknown, key: string): string {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return '';
  const v = (answer as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : '';
}

const CONTACT_LABEL: Record<ContactField, string> = {
  name: 'name',
  email: 'email',
  phone: 'phone number',
};

/** One message per contact part that isn't right; empty when the answer is fine. */
export function contactErrors(
  q: Pick<ContactInfoQuestion, 'fields'>,
  answer: unknown,
): Partial<Record<ContactField, string>> {
  const out: Partial<Record<ContactField, string>> = {};
  for (const f of contactShown(q)) {
    const v = text(answer, f);
    if (!v) {
      if (contactMode(q, f) === 'required') out[f] = `Please add your ${CONTACT_LABEL[f]}`;
      continue;
    }
    if (v.length > CONTACT_MAX[f]) out[f] = 'That’s too long';
    else if (f === 'email' && !EMAIL_RE.test(v)) out[f] = "That doesn't look like a valid email";
    else if (f === 'phone' && v.replace(/\D/g, '').length < 7) {
      out[f] = "That doesn't look like a phone number";
    }
  }
  return out;
}

/* ---------- address ---------- */

/** The address parts that show, in order. */
export function addressShown(q: Pick<AddressQuestion, 'line2' | 'country'>): AddressPart[] {
  const parts: AddressPart[] = ['street'];
  if (q.line2 !== false) parts.push('line2');
  parts.push('city', 'region', 'postal');
  if (q.country === true) parts.push('country');
  return parts;
}

/** The parts a complete address needs (line 2 is always optional). */
export function addressNeeded(q: Pick<AddressQuestion, 'format' | 'country'>): AddressPart[] {
  const parts: AddressPart[] = ['street', 'city'];
  if ((q.format ?? 'us') === 'us') parts.push('region');
  parts.push('postal');
  if (q.country === true) parts.push('country');
  return parts;
}

const ADDRESS_LABEL: Record<AddressPart, string> = {
  street: 'the street address',
  line2: 'the unit',
  city: 'the city',
  region: 'the state',
  postal: 'the ZIP code',
  country: 'the country',
};

/** True when the answer has any address text in it. */
export function addressStarted(answer: unknown): boolean {
  return (['street', 'line2', 'city', 'region', 'postal', 'country'] as const).some((k) =>
    Boolean(text(answer, k)),
  );
}

/**
 * One message per address part that isn't right. An optional address may be
 * left blank; once any part is filled, it must be complete.
 */
export function addressErrors(
  q: Pick<AddressQuestion, 'format' | 'country' | 'line2' | 'required'>,
  answer: unknown,
): Partial<Record<AddressPart, string>> {
  const out: Partial<Record<AddressPart, string>> = {};
  const us = (q.format ?? 'us') === 'us';
  if (!q.required && !addressStarted(answer)) return out;
  for (const part of addressNeeded(q)) {
    if (!text(answer, part)) {
      out[part] = `Please add ${
        part === 'region' && !us
          ? 'the region'
          : part === 'postal' && !us
            ? 'the postal code'
            : ADDRESS_LABEL[part]
      }`;
    }
  }
  for (const part of addressShown(q)) {
    const v = text(answer, part);
    if (v.length > ADDRESS_MAX[part]) out[part] = 'That’s too long';
  }
  const postal = text(answer, 'postal');
  if (postal && !out.postal) {
    if (us && !/^\d{5}(-?\d{4})?$/.test(postal)) out.postal = 'ZIP codes are 5 digits';
    else if (!us && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(postal)) {
      out.postal = "That doesn't look like a postal code";
    }
  }
  return out;
}
