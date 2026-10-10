/**
 * Question catalog coverage (ADR-063, extended by ADR-064, ADR-065 and ADR-066). Every question type must be wired
 * through every surface that knows about types. A new type added in a later
 * wave fails here (and in `SAMPLES`, at compile time) until it is: studio
 * label, palette entry and icon, validation, answer formatting, the server
 * clamp, Build with AI, and the untrusted-schema sanitizer.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { Question, QuestionType } from '@/index.js';
import { validate } from '@/logic/validation.js';
import { formatAnswerFor } from '@/logic/piping.js';
import { extFieldKey } from '@/components/questions/lazyFields.js';
import { ADDABLE_TYPES, TYPE_LABEL } from '../examples/_admin/questionTypeMeta.js';
import { TypeIcon } from '../examples/_admin/components/TypeIcon.js';
import { formatAnswerForQuestion } from '../examples/_admin/responsesFormat.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import { clampForQuestion } from '../neon/functions/submit-response/answerShape.js';
import { GENERATED_QUESTION_TYPES } from '../api/_lib/generateFormSchema.js';

const opts = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
];
/** File-like answers (voice, photos) keep only the form's own storage refs (ADR-058). */
const FORM = 'f_coverage01';
const UUID = '0b8e4f5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';

/** One minimal question and one plausible answer per type. Missing a type is a compile error. */
const SAMPLES: Record<QuestionType, { q: Question; answer: unknown }> = {
  welcome: { q: { id: 'x', type: 'welcome', title: 'Hi' }, answer: undefined },
  statement: { q: { id: 'x', type: 'statement', title: 'Note' }, answer: undefined },
  review: { q: { id: 'x', type: 'review', title: 'Check' }, answer: undefined },
  thanks: { q: { id: 'x', type: 'thanks', title: 'Bye' }, answer: undefined },
  short_text: { q: { id: 'x', type: 'short_text', title: 'T' }, answer: 'Ada' },
  long_text: { q: { id: 'x', type: 'long_text', title: 'T' }, answer: 'Long' },
  email: { q: { id: 'x', type: 'email', title: 'T' }, answer: 'a@b.co' },
  phone: { q: { id: 'x', type: 'phone', title: 'T' }, answer: '+18055550100' },
  url: { q: { id: 'x', type: 'url', title: 'T' }, answer: 'example.com' },
  number: { q: { id: 'x', type: 'number', title: 'T', display: 'stepper' }, answer: 3 },
  date: { q: { id: 'x', type: 'date', title: 'T', range: true }, answer: '2026-10-03/2026-10-04' },
  file_upload: { q: { id: 'x', type: 'file_upload', title: 'T' }, answer: undefined },
  single_choice: {
    q: { id: 'x', type: 'single_choice', title: 'T', options: opts, allowOther: true },
    answer: 'typed',
  },
  multi_choice: {
    q: { id: 'x', type: 'multi_choice', title: 'T', options: opts, allowOther: true },
    answer: ['a', 'typed'],
  },
  dropdown: {
    q: { id: 'x', type: 'dropdown', title: 'T', options: opts, allowOther: true },
    answer: 'b',
  },
  picture_choice: {
    q: {
      id: 'x',
      type: 'picture_choice',
      title: 'T',
      options: opts.map((o) => ({ ...o, src: 'https://example.com/a.jpg' })),
      allowOther: true,
    },
    answer: 'typed',
  },
  ranking: { q: { id: 'x', type: 'ranking', title: 'T', options: opts }, answer: ['b', 'a'] },
  matrix: {
    q: { id: 'x', type: 'matrix', title: 'T', rows: opts, columns: opts },
    answer: { a: 'b' },
  },
  yes_no: { q: { id: 'x', type: 'yes_no', title: 'T' }, answer: 'yes' },
  legal: { q: { id: 'x', type: 'legal', title: 'T' }, answer: 'accept' },
  scale: {
    q: { id: 'x', type: 'scale', title: 'T', min: 1, max: 5, display: 'emoji' },
    answer: 4,
  },
  nps: { q: { id: 'x', type: 'nps', title: 'T' }, answer: 9 },
  contact_info: {
    q: { id: 'x', type: 'contact_info', title: 'T', fields: { phone: 'required' } },
    answer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+18055550100' },
  },
  address: {
    q: { id: 'x', type: 'address', title: 'T', required: true, serviceArea: ['931'] },
    answer: { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' },
  },
  signature: {
    q: { id: 'x', type: 'signature', title: 'T', required: true },
    answer: { path: 'M10 150l40 -60 40 60 40 -60 40 60' },
  },
  // Wave C (ADR-065)
  image_pin: {
    q: {
      id: 'x',
      type: 'image_pin',
      title: 'T',
      image: 'https://example.com/roof.jpg',
      maxPins: 2,
    },
    answer: { pins: ['0.25,0.5', '0.7,0.1'], notes: ['leak here', ''] },
  },
  voice_note: {
    q: { id: 'x', type: 'voice_note', title: 'T', maxSeconds: 90 },
    answer: { audio: `slate-file://storage:public/${FORM}/${UUID}/voice-note.m4a`, sec: '42' },
  },
  location: {
    q: {
      id: 'x',
      type: 'location',
      title: 'T',
      center: { lat: 34.42, lng: -119.7 },
      radius: 25,
    },
    answer: { lat: '34.441', lng: '-119.812', area: 'in' },
  },
  photo_checklist: {
    q: { id: 'x', type: 'photo_checklist', title: 'T', items: opts },
    answer: {
      a: `slate-file://storage:public/${FORM}/${UUID}/front.jpg`,
      b: `slate-file://storage:public/${FORM}/${UUID}/roof.jpg`,
    },
  },
  availability: {
    q: { id: 'x', type: 'availability', title: 'T', days: ['mon', 'wed'], slotMinutes: 30 },
    answer: { mon: '09:00-11:30', wed: '14:00-15:00' },
  },
  // Wave D (ADR-066)
  signup_slots: {
    q: {
      id: 'x',
      type: 'signup_slots',
      title: 'T',
      maxPicks: 2,
      waitlist: true,
      slots: [
        { label: 'Sat 10–11am', value: 's_sat10', capacity: 8, date: '2026-10-03', start: '10:00' },
        { label: 'Bring drinks', value: 's_drinks', capacity: 3 },
      ],
    },
    answer: { slots: ['s_sat10'], wait: ['s_drinks'] },
  },
};

const CHROME = new Set<QuestionType>(['welcome', 'thanks']);
const TYPES = Object.keys(TYPE_LABEL) as QuestionType[];

describe('question catalog coverage (ADR-063)', () => {
  it('the studio lists every type once, with a label', () => {
    expect(new Set(TYPES)).toEqual(new Set(Object.keys(SAMPLES)));
    expect(ADDABLE_TYPES.map((t) => t.type).sort()).toEqual([...TYPES].sort());
  });

  it.each(TYPES)('%s: icon, validation, formatting, server clamp', (type) => {
    const { q, answer } = SAMPLES[type];
    const { container, unmount } = render(<TypeIcon type={type} />);
    expect(container.querySelector('svg')?.children.length).toBeGreaterThan(0);
    unmount();
    expect(() => validate(q, answer)).not.toThrow();
    if (answer !== undefined) expect(validate(q, answer)).toBeNull();
    expect(typeof formatAnswerFor(q, answer)).toBe('string');
    expect(typeof formatAnswerForQuestion(q, answer)).toBe('string');
    if (answer !== undefined && type !== 'file_upload') {
      const clamped = clampForQuestion(q as unknown as Record<string, unknown>, answer, {
        formId: FORM,
      });
      expect(clamped).not.toBeUndefined();
    }
    // An on-demand UI is optional; when there is one, its key is a string.
    const key = extFieldKey(q);
    expect(key === null || typeof key === 'string').toBe(true);
  });

  it('Build with AI can draft every answer type (welcome / thanks are chrome)', () => {
    const generated = new Set<string>(GENERATED_QUESTION_TYPES);
    for (const t of TYPES) {
      if (CHROME.has(t)) expect(generated.has(t)).toBe(false);
      else expect(generated.has(t)).toBe(true);
    }
  });

  it('portable schemas keep every type and its Wave A and B options', () => {
    const questions = TYPES.map((t) => ({ ...SAMPLES[t].q, id: t }));
    const out = sanitizeUntrustedSchema({
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      questions,
    } as never);
    expect(out.questions.map((q) => q.type)).toEqual(TYPES);
    const byType = Object.fromEntries(out.questions.map((q) => [q.type, q])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(byType.single_choice!.allowOther).toBe(true);
    expect(byType.number!.display).toBe('stepper');
    expect(byType.scale!.display).toBe('emoji');
    expect(byType.date!.range).toBe(true);
    // Wave B (ADR-064)
    expect(byType.contact_info!.fields).toEqual({ phone: 'required' });
    expect(byType.address!.serviceArea).toEqual(['931']);
    expect(byType.signature!.required).toBe(true);
  });

  it('Wave B types load their UI on demand (ADR-064)', () => {
    expect(extFieldKey(SAMPLES.contact_info.q)).toBe('contact-info');
    expect(extFieldKey(SAMPLES.address.q)).toBe('address');
    expect(extFieldKey(SAMPLES.signature.q)).toBe('signature');
  });

  it('Wave C types, swipe cards and the dropdown load their UI on demand (ADR-065)', () => {
    expect(extFieldKey(SAMPLES.image_pin.q)).toBe('image-pin');
    expect(extFieldKey(SAMPLES.voice_note.q)).toBe('voice-note');
    expect(extFieldKey(SAMPLES.location.q)).toBe('location');
    expect(extFieldKey(SAMPLES.photo_checklist.q)).toBe('photo-checklist');
    expect(extFieldKey(SAMPLES.availability.q)).toBe('availability');
    expect(extFieldKey(SAMPLES.dropdown.q)).toBe('dropdown');
    const swipePics = { ...SAMPLES.picture_choice.q, display: 'swipe', multiple: true } as Question;
    expect(extFieldKey(swipePics)).toBe('swipe');
    // Swipe needs multi-select; single-select stays on the grid.
    expect(extFieldKey({ ...swipePics, multiple: false } as Question)).toBe('picture-choice');
    expect(extFieldKey({ ...SAMPLES.yes_no.q, display: 'swipe' } as Question)).toBe('swipe');
    expect(extFieldKey(SAMPLES.yes_no.q)).toBeNull();
  });

  it('sign-up slots load on demand and keep their slots in portable schemas (ADR-066)', () => {
    expect(extFieldKey(SAMPLES.signup_slots.q)).toBe('signup-slots');
    const out = sanitizeUntrustedSchema({
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      questions: [{ ...SAMPLES.signup_slots.q, id: 'slots', showRemaining: false }],
    } as never);
    const q = out.questions[0] as unknown as Record<string, unknown>;
    expect(q.slots).toEqual((SAMPLES.signup_slots.q as { slots: unknown }).slots);
    expect(q.maxPicks).toBe(2);
    expect(q.waitlist).toBe(true);
    expect(q.showRemaining).toBe(false);
  });

  it('portable schemas keep Wave C options in known shapes (ADR-065)', () => {
    const out = sanitizeUntrustedSchema({
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { ...SAMPLES.image_pin.q, id: 'pin' },
        { ...SAMPLES.location.q, id: 'loc', radiusUnit: 'km', privacyNote: 'Just the area.' },
        { ...SAMPLES.availability.q, id: 'week', startTime: '07:30', endTime: '12:00' },
        { ...SAMPLES.photo_checklist.q, id: 'shots' },
        { ...SAMPLES.voice_note.q, id: 'voice', allowTyped: false },
        { ...SAMPLES.picture_choice.q, id: 'swipe', display: 'swipe', multiple: true },
        { ...SAMPLES.yes_no.q, id: 'yn', display: 'swipe' },
      ],
    } as never);
    const by = Object.fromEntries(out.questions.map((q) => [q.id, q])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(by.pin!.image).toBe('https://example.com/roof.jpg');
    expect(by.pin!.maxPins).toBe(2);
    expect(by.loc!.center).toEqual({ lat: 34.42, lng: -119.7 });
    expect(by.loc!.radius).toBe(25);
    expect(by.loc!.radiusUnit).toBe('km');
    expect(by.week!.days).toEqual(['mon', 'wed']);
    expect(by.week!.slotMinutes).toBe(30);
    expect(by.week!.startTime).toBe('07:30');
    expect(by.shots!.items).toEqual(opts);
    expect(by.voice!.maxSeconds).toBe(90);
    expect(by.voice!.allowTyped).toBe(false);
    expect(by.swipe!.display).toBe('swipe');
    expect(by.yn!.display).toBe('swipe');
  });
});
