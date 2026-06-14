import { describe, expect, it, vi } from 'vitest';
import {
  buildPublicShareUrl,
  resolveFormSlug,
  resolvePrimaryShareUrl,
  slugify,
} from '../examples/_admin/shareUrls.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Wild Wash Intake')).toBe('wild-wash-intake');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });

  it('falls back to form when empty', () => {
    expect(slugify('   ')).toBe('form');
  });
});

describe('resolveFormSlug', () => {
  it('prefers explicit slug', () => {
    expect(
      resolveFormSlug({ slug: 'custom-path', name: 'Ignored', id: 'f_abc' }),
    ).toBe('custom-path');
  });

  it('falls back to slugified name', () => {
    expect(resolveFormSlug({ name: 'Quote Form', id: 'f_abc' })).toBe('quote-form');
  });

  it('falls back to id when name slug is empty', () => {
    expect(resolveFormSlug({ name: '!!!', id: 'f_abc' })).toBe('f_abc');
  });
});

describe('resolvePrimaryShareUrl', () => {
  it('prefers public URL when base is set', () => {
    vi.stubEnv('VITE_PUBLIC_FORM_BASE', 'https://example.com/quote');
    const out = resolvePrimaryShareUrl('f_abc', 'wild-wash', 'Wild Wash');
    expect(out.mode).toBe('public');
    expect(out.url).toBe('https://example.com/quote/wild-wash');
    vi.unstubAllEnvs();
  });
});

describe('buildPublicShareUrl', () => {
  it('returns null when base is unset', () => {
    vi.stubEnv('VITE_PUBLIC_FORM_BASE', '');
    expect(buildPublicShareUrl('my-form')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('joins base and slug without double slashes', () => {
    vi.stubEnv('VITE_PUBLIC_FORM_BASE', 'https://example.com/quote/');
    expect(buildPublicShareUrl('wild-wash')).toBe('https://example.com/quote/wild-wash');
    vi.unstubAllEnvs();
  });
});
