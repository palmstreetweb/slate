import { describe, expect, it } from 'vitest';
import { defineSchema } from '@/index.js';
import {
  buildPortableShareUrl,
  canEncodePortableSchema,
  decodePortableSchema,
  encodePortableSchema,
} from '../examples/_admin/portableShare.js';

const sample = defineSchema({
  brand: { name: 'Test' },
  theme: 'editorial',
  themeMode: 'toggle',
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hi', cta: 'Start' },
    { id: 'name', type: 'short_text', title: 'Name?', required: true },
  ],
});

describe('portableShare', () => {
  it('round-trips schema through encode/decode', () => {
    const token = encodePortableSchema(sample, { formId: 'f_abc', name: 'Test' });
    const out = decodePortableSchema(token);
    expect(out?.schema.questions).toHaveLength(2);
    expect(out?.formId).toBe('f_abc');
    expect(out?.name).toBe('Test');
  });

  it('rejects garbage tokens', () => {
    expect(decodePortableSchema('')).toBeNull();
    expect(decodePortableSchema('not-valid-base64!!!')).toBeNull();
  });

  it('canEncodePortableSchema returns true for small forms', () => {
    expect(canEncodePortableSchema(sample)).toBe(true);
  });

  it('buildPortableShareUrl includes hash route', () => {
    const url = buildPortableShareUrl(sample);
    expect(url).toContain('#/r?d=');
  });
});
