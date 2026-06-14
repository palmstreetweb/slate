/**
 * Mono — stark black-and-white brutalist.
 *
 * Maximum contrast, heavy Inter, square corners, thick borders. Reuses the
 * Swiss geometric `shapes` decoration but with a grayscale deco palette (set
 * in tokens.css), so the per-step compositions read as bold monochrome forms.
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const mono: Theme = {
  name: 'Mono',
  tagline: 'Brutalist · black & white',
  decoration: 'shapes',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '0px',
    borderWidth: '2px',
    titleWeight: 800,
    titleTracking: '-0.03em',
    titleLineHeight: 1.0,
    titleSize: 'clamp(2.2rem, 5.6vw, 3.8rem)',
    transform: 'none',
  },
  light: {
    bg: '#FFFFFF',
    bg2: '#F2F2F2',
    bg3: '#E6E6E6',
    text: '#000000',
    muted: '#2E2E2E',
    dim: '#707070',
    accent: '#111111',
    accentRgb: '17 17 17',
    accentOnLight: '#111111',
    accentLo: 'rgb(17 17 17 / 0.06)',
    border: 'rgba(0, 0, 0, 0.20)',
    borderMd: 'rgba(0, 0, 0, 0.42)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#000000',
    bg2: '#0D0D0D',
    bg3: '#161616',
    text: '#FFFFFF',
    muted: '#C4C4C4',
    dim: '#7C7C7C',
    accent: '#FFFFFF',
    accentRgb: '255 255 255',
    accentOnLight: '#111111',
    accentLo: 'rgb(255 255 255 / 0.08)',
    border: 'rgba(255, 255, 255, 0.20)',
    borderMd: 'rgba(255, 255, 255, 0.42)',
    colorScheme: 'dark',
  },
};
