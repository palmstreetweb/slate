/**
 * Contact block and address answers, and the service-area check (ADR-064):
 * per-part validation, ZIP prefix matching, conditions with the in / out of
 * area sentinels, piping and the schema check.
 */

import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import {
  IN_AREA_VALUE,
  OUT_OF_AREA_VALUE,
  areaIndex,
  areaStatus,
  formatAddress,
  normalizePostal,
  parseServiceAreaText,
  serviceAreaPrefixes,
} from '@/logic/address.js';
import {
  addressErrors,
  addressShown,
  contactErrors,
  contactMode,
  contactShown,
} from '@/logic/contact.js';
import { evaluate } from '@/logic/conditional.js';
import { formatAnswerFor, pipe } from '@/logic/piping.js';
import { resolveJumpTarget, visibleQuestions } from '@/logic/progress.js';
import { checkSchema } from '@/logic/schemaCheck.js';
import { validate } from '@/logic/validation.js';
import { canPrefill } from '@/logic/prefill.js';

const contact: Question = { id: 'c', type: 'contact_info', title: 'Reach you?' };
const address: Question = {
  id: 'a',
  type: 'address',
  title: 'Address?',
  required: true,
  serviceArea: ['93101', '931*', ' 93455 '],
};
const home = { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' };

describe('contact block', () => {
  it('defaults to name + email required, phone optional', () => {
    expect(contactShown(contact)).toEqual(['name', 'email', 'phone']);
    expect(contactMode(contact, 'name')).toBe('required');
    expect(contactMode(contact, 'phone')).toBe('optional');
    const off = { ...contact, fields: { phone: 'off' as const, email: 'optional' as const } };
    expect(contactShown(off)).toEqual(['name', 'email']);
  });

  it('reports one message per part', () => {
    expect(contactErrors(contact, {})).toEqual({
      name: 'Please add your name',
      email: 'Please add your email',
    });
    expect(contactErrors(contact, { name: 'Ada', email: 'nope', phone: '12' })).toEqual({
      email: "That doesn't look like a valid email",
      phone: 'Please check the phone number',
    });
    expect(contactErrors(contact, { name: 'Ada', email: 'a@b.co' })).toEqual({});
  });

  it('validate() returns the first part’s message, keyed by the part', () => {
    expect(validate(contact, { email: 'a@b.co' })).toEqual({
      code: 'name',
      message: 'Please add your name',
    });
    expect(validate(contact, { name: 'Ada', email: 'a@b.co', phone: '+18055550100' })).toBeNull();
    expect(validate(contact, 'Ada')?.code).toBe('shape');
    const optional: Question = {
      ...contact,
      fields: { name: 'optional', email: 'optional', phone: 'optional' },
    } as Question;
    expect(validate(optional, undefined)).toBeNull();
  });

  it('pipes as the name; the review screen shows every part', () => {
    const answers = { c: { name: 'Ada', email: 'ada@example.com' } };
    expect(pipe('Thanks, {{field:c}}!', answers, 0, [contact])).toBe('Thanks, Ada!');
    expect(formatAnswerFor(contact, answers.c)).toBe('Ada · ada@example.com');
    expect(pipe('Thanks, {{field:c}}!', { c: { email: 'x@y.co' } }, 0, [contact])).toBe(
      'Thanks, x@y.co!',
    );
  });

  it('schemaCheck flags a block with every part off', () => {
    const none = {
      ...contact,
      fields: { name: 'off', email: 'off', phone: 'off' },
    } as Question;
    expect(checkSchema([none]).map((i) => i.kind)).toEqual(['no_fields']);
    expect(checkSchema([contact])).toEqual([]);
  });

  it('is never prefilled from a link', () => {
    expect(canPrefill(contact)).toBe(false);
    expect(canPrefill(address)).toBe(false);
  });
});

describe('address', () => {
  it('shows the unit line by default, the country only when asked', () => {
    expect(addressShown(address)).toEqual(['street', 'line2', 'city', 'region', 'postal']);
    expect(addressShown({ line2: false, country: true })).toEqual([
      'street',
      'city',
      'region',
      'postal',
      'country',
    ]);
  });

  it('a required US address needs street, city, state and a 5-digit ZIP', () => {
    expect(Object.keys(addressErrors(address as never, {}))).toEqual([
      'street',
      'city',
      'region',
      'postal',
    ]);
    expect(addressErrors(address as never, { ...home, postal: '931' })).toEqual({
      postal: 'ZIP codes are 5 digits',
    });
    expect(addressErrors(address as never, { ...home, postal: '93101-1234' })).toEqual({});
    expect(validate(address, home)).toBeNull();
  });

  it('an optional address may be blank, but once started must be complete', () => {
    const optional = { ...address, required: false } as Question;
    expect(validate(optional, undefined)).toBeNull();
    expect(validate(optional, { city: 'Ojai' })?.code).toBe('street');
  });

  it('international: region optional, postal codes with letters', () => {
    const intl = {
      id: 'i',
      type: 'address',
      title: 'A',
      required: true,
      format: 'international',
    } as Question;
    expect(validate(intl, { street: '1 Main', city: 'Vancouver', postal: 'V6B 1A1' })).toBeNull();
    expect(validate(intl, { street: '1 Main', city: 'Vancouver' })?.message).toBe(
      'Please add the postal code',
    );
  });

  it('formats as one line', () => {
    expect(formatAddress({ ...home, line2: 'Apt 4' })).toBe(
      '12 Palm St, Apt 4, Santa Barbara, CA 93101',
    );
    expect(formatAddress('x')).toBe('');
    expect(formatAnswerFor(address, home)).toBe('12 Palm St, Santa Barbara, CA 93101');
  });
});

describe('service area', () => {
  it('normalizes the owner’s list: prefixes, stars, spaces, junk dropped', () => {
    expect(serviceAreaPrefixes(['93101', '931*', ' 93455 ', 'v6b 1a1', 'no!', '', 7])).toEqual([
      '93101',
      '931',
      '93455',
      'V6B1A1',
    ]);
    expect(parseServiceAreaText('93101, 93103\n931*;  V6B')).toEqual([
      '93101',
      '93103',
      '931*',
      'V6B',
    ]);
    expect(normalizePostal('93101-1234')).toBe('931011234');
  });

  it('matches a ZIP by prefix; no ZIP or no area is neither in nor out', () => {
    const area = serviceAreaPrefixes(address.type === 'address' ? address.serviceArea : []);
    expect(areaStatus(home, area)).toBe('in');
    expect(areaStatus({ ...home, postal: '93199' }, area)).toBe('in');
    expect(areaStatus({ ...home, postal: '93454' }, area)).toBe('out');
    expect(areaStatus({ ...home, postal: '93455-2000' }, area)).toBe('in');
    expect(areaStatus({ street: 'x' }, area)).toBeNull();
    expect(areaStatus(home, [])).toBeNull();
  });

  it('conditions test in / out of the area through the sentinels', () => {
    const areas = areaIndex([address]);
    const out = { field: 'a', op: 'equals' as const, value: OUT_OF_AREA_VALUE };
    const inside = { field: 'a', op: 'equals' as const, value: IN_AREA_VALUE };
    expect(evaluate(out, { a: { ...home, postal: '90210' } }, undefined, areas)).toBe(true);
    expect(evaluate(out, { a: home }, undefined, areas)).toBe(false);
    expect(evaluate(inside, { a: home }, undefined, areas)).toBe(true);
    expect(evaluate({ ...out, op: 'not_equals' }, { a: home }, undefined, areas)).toBe(true);
    // Without the index (or without an answer yet) nothing matches.
    expect(evaluate(out, { a: { postal: '90210' } })).toBe(false);
    expect(evaluate(out, {}, undefined, areas)).toBe(false);
    expect(evaluate({ field: 'a', op: 'is_empty' }, { a: {} })).toBe(true);
    expect(evaluate({ field: 'a', op: 'is_not_empty' }, { a: home })).toBe(true);
  });

  it('routes an out-of-area answer to its own ending', () => {
    const outside = { field: 'a', op: 'equals' as const, value: OUT_OF_AREA_VALUE };
    const questions: Question[] = [
      { ...address, logic: [{ if: outside, goTo: 'sorry' }] } as Question,
      { id: 'when', type: 'date', title: 'When?' },
      { id: 'sorry', type: 'thanks', title: 'Sorry', visibleIf: outside },
      { id: 'done', type: 'thanks', title: 'Thanks' },
    ];
    const far = { a: { ...home, postal: '10001' } };
    const visible = visibleQuestions(questions, far);
    expect(visible.map((q) => q.id)).toEqual(['a', 'when', 'sorry', 'done']);
    const jump = resolveJumpTarget(visible[0]!, visible, far, undefined, areaIndex(questions));
    expect(visible[jump!]!.id).toBe('sorry');
    const near = { a: home };
    expect(visibleQuestions(questions, near).map((q) => q.id)).toEqual(['a', 'when', 'done']);
  });

  it('schemaCheck flags area conditions on an address without an area, and bad entries', () => {
    const plain: Question = { id: 'a', type: 'address', title: 'A' };
    const cond = { field: 'a', op: 'equals' as const, value: OUT_OF_AREA_VALUE };
    expect(
      checkSchema([plain, { id: 't', type: 'thanks', title: 'T', visibleIf: cond }]).map(
        (i) => i.kind,
      ),
    ).toEqual(['area_off']);
    expect(
      checkSchema([{ ...plain, serviceArea: ['93101', '9-3!'] } as Question]).map((i) => i.kind),
    ).toEqual(['bad_service_area']);
  });
});
