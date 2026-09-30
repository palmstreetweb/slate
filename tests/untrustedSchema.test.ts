import { describe, expect, it } from 'vitest';
import type { Schema } from '../src/index.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';

const base = {
  brand: { name: 'X', logo: 'https://x/l.png' },
  theme: 'editorial',
  themeMode: 'system',
};

describe('sanitizeUntrustedSchema (portable links, ADR-046)', () => {
  it('drops javascript: redirects and keeps https ones', () => {
    const s = sanitizeUntrustedSchema({
      ...base,
      questions: [
        { id: 'a', type: 'thanks', title: 'T', redirectUrl: 'javascript:alert(1)' },
        { id: 'b', type: 'thanks', title: 'T', redirectUrl: 'https://ok.example/done' },
      ],
    } as unknown as Schema);
    expect((s.questions[0] as { redirectUrl?: string }).redirectUrl).toBeUndefined();
    expect((s.questions[1] as { redirectUrl?: string }).redirectUrl).toBe(
      'https://ok.example/done',
    );
  });

  it('only allows https picture-choice images and strips brand.logo', () => {
    const s = sanitizeUntrustedSchema({
      ...base,
      questions: [
        {
          id: 'p',
          type: 'picture_choice',
          title: 'Pick',
          options: [
            { value: 'a', label: 'A', src: 'http://tracker.example/pixel.gif' },
            { value: 'b', label: 'B', src: 'https://cdn.example/b.jpg' },
          ],
        },
      ],
    } as unknown as Schema);
    const opts = (s.questions[0] as { options: { src?: string }[] }).options;
    expect(opts[0]!.src).toBeUndefined();
    expect(opts[1]!.src).toBe('https://cdn.example/b.jpg');
    expect((s.brand as { logo?: string }).logo).toBeUndefined();
  });

  it('caps runaway text', () => {
    const s = sanitizeUntrustedSchema({
      ...base,
      questions: [{ id: 'w', type: 'welcome', title: 'x'.repeat(10_000), cta: 'Go' }],
    } as unknown as Schema);
    expect((s.questions[0] as { title: string }).title.length).toBe(2000);
  });

  it('keeps ADR-063 options only in their known shapes', () => {
    const s = sanitizeUntrustedSchema({
      ...base,
      questions: [
        {
          id: 's',
          type: 'scale',
          title: 'Rate',
          min: 1,
          max: 5,
          display: 'stars',
          sliderIcon: 'rocket',
        },
        { id: 'n', type: 'number', title: 'N', display: 'stars', unit: 'u'.repeat(100), prefix: 7 },
        {
          id: 'c',
          type: 'single_choice',
          title: 'C',
          options: [{ label: 'A', value: 'a' }],
          allowOther: 'yes',
          otherLabel: 'x'.repeat(100),
        },
        { id: 'd', type: 'date', title: 'D', range: true, includeTime: 1 },
      ],
    } as unknown as Schema);
    const [scale, num, choice, date] = s.questions as unknown as Record<string, unknown>[];
    expect(scale!.display).toBe('stars');
    expect(scale).not.toHaveProperty('sliderIcon');
    expect(num).not.toHaveProperty('display');
    expect(num!.unit).toHaveLength(24);
    expect(num).not.toHaveProperty('prefix');
    expect(choice).not.toHaveProperty('allowOther');
    expect(choice!.otherLabel).toHaveLength(40);
    expect(date!.range).toBe(true);
    expect(date).not.toHaveProperty('includeTime');
  });
});
