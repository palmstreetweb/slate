/**
 * Review fixes of 2026-10-05 in the engine's pure logic: limits below 1 read
 * the way the field and the server read them (ENG-02), a link's prefill keeps
 * the picks a question really allows (ENG-04), and a unit never follows a
 * bound of 1 (COPY-R15).
 */

import { describe, expect, it } from 'vitest';
import type { Question } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import { prefillAnswers } from '@/logic/prefill.js';

describe('limits below 1 are the usual ones, as the field and the server read them (ENG-02)', () => {
  const files = (extra: object) =>
    ({ id: 'f', type: 'file_upload', title: 'Files', ...extra }) as Question;
  const refs = (n: number) => Array.from({ length: n }, (_, i) => `slate-file://${i}`);

  it('a file count of 0 or less is 10', () => {
    for (const maxFiles of [0, -1, Number.NaN]) {
      expect(validate(files({ maxFiles, required: true }), refs(1))).toBeNull();
      expect(validate(files({ maxFiles }), refs(10))).toBeNull();
      expect(validate(files({ maxFiles }), refs(11))?.message).toBe('Attach at most 10 files');
      // Optional, with nothing attached: it can be skipped.
      expect(validate(files({ maxFiles }), [])).toBeNull();
    }
    expect(validate(files({ maxFiles: 2.5 }), refs(3))?.message).toBe('Attach at most 2 files');
  });

  it('sign-up picks of 0 or less are 1', () => {
    const slots = (maxPicks: number) =>
      ({
        id: 's',
        type: 'signup_slots',
        title: 'When?',
        maxPicks,
        slots: [
          { value: 'a', label: 'A', capacity: 2 },
          { value: 'b', label: 'B', capacity: 2 },
        ],
      }) as Question;
    for (const maxPicks of [0, -2]) {
      expect(validate(slots(maxPicks), { slots: ['a'] })).toBeNull();
      expect(validate(slots(maxPicks), { slots: ['a', 'b'] })?.message).toBe('Pick up to 1');
    }
  });
});

describe('a link’s prefill keeps the picks the question allows (ENG-04)', () => {
  const multi = (extra: object) =>
    ({
      id: 'm',
      type: 'multi_choice',
      title: 'Pick',
      prefillKey: 'm',
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
        { label: 'C', value: 'c' },
      ],
      ...extra,
    }) as Question;

  it('a maximum nobody is held to (0, below 1, below the minimum) keeps every pick', () => {
    for (const extra of [{ max: 0 }, { max: -1 }, { min: 3, max: 2 }]) {
      expect(prefillAnswers([multi(extra)], { m: 'a,b,c' })).toEqual({ m: ['a', 'b', 'c'] });
    }
  });

  it('a real maximum still keeps the first picks', () => {
    expect(prefillAnswers([multi({ max: 2 })], { m: 'a,b,c' })).toEqual({ m: ['a', 'b'] });
  });
});

describe('a unit never follows a bound of 1 (COPY-R15)', () => {
  const guests = (extra: object) =>
    ({ id: 'g', type: 'number', title: 'How many guests?', unit: 'guests', ...extra }) as Question;

  it.each([
    [{ min: 1 }, 0, 'Enter 1 or more'],
    [{ min: 1, max: 1 }, 2, 'Enter 1'],
    [{ max: 1 }, 2, 'Enter 1 or less'],
    [{ min: 2 }, 1, 'Enter 2 guests or more'],
    [{ max: 3 }, 4, 'Enter 3 guests or less'],
    [{ min: 1, max: 10 }, 0, 'Enter a number from 1 to 10 guests'],
    [{ min: 0, max: 1 }, 2, 'Enter a number from 0 to 1'],
  ] as const)('%o, %d → %s', (extra, n, message) => {
    expect(validate(guests(extra), n)?.message).toBe(message);
  });
});
