import { describe, it, expect } from 'vitest';
import { validate } from '@/logic/validation.js';
import type {
  EmailQuestion,
  LongTextQuestion,
  MultiChoiceQuestion,
  NumberQuestion,
  PhoneQuestion,
  ScaleQuestion,
  ShortTextQuestion,
  SingleChoiceQuestion,
} from '@/types/Question.js';

describe('validation — chrome screens always pass', () => {
  it('welcome / statement / thanks → null', () => {
    expect(validate({ id: 'w', type: 'welcome', title: 'hi' }, undefined)).toBeNull();
    expect(validate({ id: 's', type: 'statement', title: 'fyi' }, undefined)).toBeNull();
    expect(validate({ id: 't', type: 'thanks', title: 'bye' }, undefined)).toBeNull();
  });
});

describe('validation — short_text', () => {
  const base: ShortTextQuestion = { id: 'q', type: 'short_text', title: 'X' };

  it('not required + empty = ok', () => {
    expect(validate(base, '')).toBeNull();
    expect(validate(base, undefined)).toBeNull();
  });

  it('required + empty = required error', () => {
    expect(validate({ ...base, required: true }, '')?.code).toBe('required');
    expect(validate({ ...base, required: true }, '   ')?.code).toBe('required');
  });

  it('maxLength enforced', () => {
    const q: ShortTextQuestion = { ...base, maxLength: 3 };
    expect(validate(q, 'hi')).toBeNull();
    expect(validate(q, 'hello')?.code).toBe('too_long');
  });

  it('pattern + custom error', () => {
    const q: ShortTextQuestion = {
      ...base,
      pattern: /^\d{5}$/,
      patternError: 'must be 5 digits',
    };
    expect(validate(q, '12345')).toBeNull();
    expect(validate(q, 'abcde')?.message).toBe('must be 5 digits');
  });

  it('pattern is skipped on empty (let required handle it)', () => {
    const q: ShortTextQuestion = { ...base, pattern: /^\d+$/ };
    expect(validate(q, '')).toBeNull();
  });
});

describe('validation — long_text', () => {
  it('respects required + maxLength', () => {
    const q: LongTextQuestion = { id: 'q', type: 'long_text', title: 'X', required: true, maxLength: 10 };
    expect(validate(q, '')?.code).toBe('required');
    expect(validate(q, 'short')).toBeNull();
    expect(validate(q, 'this is way too long')?.code).toBe('too_long');
  });
});

describe('validation — email', () => {
  const q: EmailQuestion = { id: 'e', type: 'email', title: 'E', required: true };

  it('rejects bad addresses', () => {
    expect(validate(q, 'notanemail')?.code).toBe('email');
    expect(validate(q, 'a@b')?.code).toBe('email');
    expect(validate(q, '@b.c')?.code).toBe('email');
  });

  it('accepts valid addresses', () => {
    expect(validate(q, 'a@b.co')).toBeNull();
    expect(validate(q, 'caleb+tag@palmstreetweb.com')).toBeNull();
  });

  it('required + empty → required (not email)', () => {
    expect(validate(q, '')?.code).toBe('required');
  });
});

describe('validation — phone', () => {
  it('only checks presence at the engine level (PhoneField does format check)', () => {
    const q: PhoneQuestion = { id: 'p', type: 'phone', title: 'P', required: true };
    expect(validate(q, '')?.code).toBe('required');
    expect(validate(q, '+15558675309')).toBeNull();
    // optional + empty → ok
    expect(validate({ id: 'p', type: 'phone', title: 'P' }, '')).toBeNull();
  });
});

describe('validation — number', () => {
  it('respects min/max range', () => {
    const q: NumberQuestion = { id: 'n', type: 'number', title: 'N', min: 1, max: 10 };
    expect(validate(q, 5)).toBeNull();
    expect(validate(q, 0)?.code).toBe('min');
    expect(validate(q, 11)?.code).toBe('max');
  });

  it('required + missing → required', () => {
    const q: NumberQuestion = { id: 'n', type: 'number', title: 'N', required: true };
    expect(validate(q, undefined)?.code).toBe('required');
    expect(validate(q, 0)).toBeNull();
  });
});

describe('validation — scale', () => {
  it('clamps to [min, max]', () => {
    const q: ScaleQuestion = { id: 'r', type: 'scale', title: 'Rate', min: 0, max: 10 };
    expect(validate(q, 5)).toBeNull();
    expect(validate(q, -1)?.code).toBe('min');
    expect(validate(q, 11)?.code).toBe('max');
  });
});

describe('validation — single_choice', () => {
  const q: SingleChoiceQuestion = {
    id: 's',
    type: 'single_choice',
    title: 'Pick',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ],
  };

  it('defaults to required', () => {
    expect(validate(q, '')?.code).toBe('required');
    expect(validate(q, 'a')).toBeNull();
  });

  it('opt-out via required: false', () => {
    expect(validate({ ...q, required: false }, '')).toBeNull();
  });
});

describe('validation — multi_choice', () => {
  const q: MultiChoiceQuestion = {
    id: 'm',
    type: 'multi_choice',
    title: 'Multi',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
      { label: 'C', value: 'c' },
    ],
  };

  it('no min/max → any selection (including 0) is ok', () => {
    expect(validate(q, [])).toBeNull();
    expect(validate(q, ['a'])).toBeNull();
  });

  it('enforces min', () => {
    expect(validate({ ...q, min: 2 }, ['a'])?.code).toBe('min_selections');
    expect(validate({ ...q, min: 2 }, ['a', 'b'])).toBeNull();
  });

  it('enforces max', () => {
    expect(validate({ ...q, max: 2 }, ['a', 'b', 'c'])?.code).toBe('max_selections');
    expect(validate({ ...q, max: 2 }, ['a', 'b'])).toBeNull();
  });

  it('min: 1 has friendlier error message', () => {
    expect(validate({ ...q, min: 1 }, [])?.message).toBe('Please pick at least one');
  });
});
