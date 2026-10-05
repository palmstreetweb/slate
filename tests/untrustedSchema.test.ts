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

describe('numbers a crafted link can’t abuse (F14, decision 1)', () => {
  const one = (q: Record<string, unknown>) =>
    sanitizeUntrustedSchema({ ...base, questions: [q] } as unknown as Schema)
      .questions[0] as unknown as Record<string, unknown>;
  const scale = (extra: Record<string, unknown>) =>
    one({ id: 's', type: 'scale', title: 'S', ...extra });

  it('a scale step of 0 or less is dropped, and a huge span is capped', () => {
    expect(scale({ min: 1, max: 5, step: 0 })).not.toHaveProperty('step');
    expect(scale({ min: 1, max: 5, step: -1 })).not.toHaveProperty('step');
    expect(scale({ min: 0, max: 2_000_000 })).toMatchObject({ min: 0, max: 100 });
    expect(scale({ min: 0, max: 1000, step: 0.5 })).toMatchObject({ min: 0, max: 50, step: 0.5 });
    expect(scale({ min: 9, max: 1 })).toMatchObject({ min: 1, max: 9 });
    expect(scale({ min: 'x', max: null })).toMatchObject({ min: 0, max: 10 });
    // What a fair link asked for stays exactly as it was.
    expect(scale({ min: 1, max: 5 })).toMatchObject({ min: 1, max: 5 });
  });

  it('the scale a crafted link draws is small enough to render', async () => {
    const { createElement } = await import('react');
    const { render } = await import('@testing-library/react');
    const { ScaleField } = await import('../src/components/questions/ScaleField.js');
    const { MAX_CELLS } = await import('../src/components/questions/ext/scaleCells.js');
    const q = scale({ min: 0, max: 2_000_000, step: 0 });
    // The link is capped at 0–100 here, and the numbers scale itself draws at
    // most MAX_CELLS (21) cells whatever a schema says (QA w2b), so the first 21.
    expect(q).toMatchObject({ min: 0, max: 100 });
    const { container } = render(
      createElement(ScaleField, {
        question: q as never,
        answers: {},
        initialValue: undefined,
        onAnswer: () => {},
        onAdvance: () => {},
      }),
    );
    const cells = container.querySelectorAll('[role="radio"]');
    expect(cells).toHaveLength(MAX_CELLS);
    expect(cells[0]!.textContent).toBe('0');
    expect(cells[MAX_CELLS - 1]!.textContent).toBe('20');
  });

  it('bounds that leave no answer, and boxes that can’t hold a letter, go', () => {
    const inverted = one({ id: 'n', type: 'number', title: 'N', min: 10, max: 5 });
    expect(inverted).not.toHaveProperty('min');
    expect(inverted).not.toHaveProperty('max');
    expect(one({ id: 'n', type: 'number', title: 'N', step: 0 })).not.toHaveProperty('step');
    expect(
      one({ id: 'd', type: 'date', title: 'D', min: '2026-12-01', max: '2026-01-01' }),
    ).not.toHaveProperty('min');
    expect(one({ id: 't', type: 'short_text', title: 'T', maxLength: 0 })).not.toHaveProperty(
      'maxLength',
    );
    expect(one({ id: 't', type: 'long_text', title: 'T', maxLength: 5.5 })).toMatchObject({
      maxLength: 5,
    });
  });

  it('pick counts nobody can meet are brought into reach', () => {
    const options = ['a', 'b', 'c'].map((v) => ({ label: v, value: v }));
    const multi = (extra: Record<string, unknown>) =>
      one({ id: 'm', type: 'multi_choice', title: 'M', options, ...extra });
    expect(multi({ min: 10, max: 0 })).toMatchObject({ min: 3 });
    expect(multi({ min: 10, max: 0 })).not.toHaveProperty('max');
    expect(multi({ min: 2, max: 1 })).not.toHaveProperty('max');
    expect(multi({ min: 1, max: 2 })).toMatchObject({ min: 1, max: 2 });
    expect(
      one({ id: 'p', type: 'picture_choice', title: 'P', options: [], min: 2, max: 3 }),
    ).not.toHaveProperty('min');
  });
});

describe('the theme a crafted link may use (F31)', () => {
  it('keeps a built-in theme; the studio’s own or an unknown name becomes swiss', async () => {
    const { safeThemeName } = await import('../examples/_admin/sanitizeUntrustedSchema.js');
    const theme = (t: unknown) =>
      sanitizeUntrustedSchema({ ...base, theme: t, questions: [] } as unknown as Schema).theme;
    expect(theme('midnight')).toBe('midnight');
    expect(theme('slate')).toBe('swiss');
    expect(theme('constructor')).toBe('swiss');
    expect(theme(undefined)).toBe('swiss');
    expect(safeThemeName('__proto__')).toBe('swiss');
  });
});
