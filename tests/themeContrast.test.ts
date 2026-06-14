import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themes } from '@/themes/index.js';
import type { ThemeName } from '@/types/Theme.js';
import { contrastRatio } from '@/utils/contrast.js';

/**
 * WCAG AA for large UI controls (buttons, scale cells). We validate the
 * accent-fill / on-accent pair (`--slate-bg` foreground on `--slate-accent`
 * background) for every built-in theme in both modes.
 */
const MIN_ACCENT_ON_CONTRAST = 3;

const themeNames = Object.keys(themes) as ThemeName[];

describe('theme accent/on-accent contrast', () => {
  for (const name of themeNames) {
    const theme = themes[name];
    for (const mode of ['light', 'dark'] as const) {
      const { accent, bg, text } = theme[mode];

      it(`${name} ${mode}: --slate-bg on --slate-accent meets ${MIN_ACCENT_ON_CONTRAST}:1`, () => {
        const ratio = contrastRatio(bg, accent);
        expect(ratio).toBeGreaterThanOrEqual(MIN_ACCENT_ON_CONTRAST);
      });

      it(`${name} ${mode}: accent must not match page text (avoids invisible #fff-on-white)`, () => {
        // When accent === text, using `color: var(--slate-text)` on accent fills
        // is invisible. Themes may share values (mono dark) — on-accent must
        // then come from `--slate-bg`, not `--slate-text`.
        if (accent.toLowerCase() === text.toLowerCase()) {
          expect(bg.toLowerCase()).not.toBe(accent.toLowerCase());
          expect(contrastRatio(bg, accent)).toBeGreaterThanOrEqual(MIN_ACCENT_ON_CONTRAST);
        }
      });
    }
  }
});

describe('accent fill CSS discipline', () => {
  const questionsCss = readFileSync(
    resolve(import.meta.dirname, '../src/styles/questions.css'),
    'utf8',
  );
  const baseCss = readFileSync(resolve(import.meta.dirname, '../src/styles/base.css'), 'utf8');

  it('questions.css does not hardcode white foregrounds on accent surfaces', () => {
    expect(questionsCss).not.toMatch(/color:\s*#fff[^0-9a-f]/i);
    expect(questionsCss).not.toMatch(/color:\s*white\b/i);
  });

  it('questions.css defines --slate-on-accent usage on accent fills', () => {
    expect(questionsCss).toContain('var(--slate-on-accent)');
  });

  it('tokens.css aliases --slate-on-accent to --slate-bg', () => {
    const tokensCss = readFileSync(
      resolve(import.meta.dirname, '../src/styles/tokens.css'),
      'utf8',
    );
    expect(tokensCss).toMatch(/--slate-on-accent:\s*var\(--slate-bg\)/);
  });

  it('resume primary button uses on-accent foreground', () => {
    expect(baseCss).toMatch(
      /\.slate-resume-btn--primary[\s\S]*?color:\s*var\(--slate-on-accent\)/,
    );
  });
});
