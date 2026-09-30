/**
 * Question catalog coverage (ADR-063, extended by ADR-064). Every question type must be wired
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
import { GENERATED_QUESTION_TYPES } from '../api/generateFormSchema.js';

const opts = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
];

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
      expect(clampForQuestion(q as unknown as Record<string, unknown>, answer)).not.toBeUndefined();
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
});
