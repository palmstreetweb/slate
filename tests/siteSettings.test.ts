import { describe, expect, it } from 'vitest';
import { formatByteSize } from '../examples/_admin/_siteSettings.js';

describe('_siteSettings', () => {
  it('formatByteSize uses sensible units', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(2 * 1024 * 1024)).toBe('2.00 MB');
  });
});
