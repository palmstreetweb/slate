/**
 * Forest — earthy sage and warm paper with a soft grain texture.
 *
 * Organic and quiet: a Fraunces display over an Inter body, muted greens, and
 * the same fractal-noise grain overlay editorial uses (grain decoration —
 * static, not per-step).
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const forest: Theme = {
  name: 'Forest',
  tagline: 'Earthy sage · soft grain',
  decoration: 'grain',
  static: {
    fontDisplay: "'Fraunces', Georgia, serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '6px',
    borderWidth: '1.5px',
    titleWeight: 500,
    titleTracking: '-0.02em',
    titleLineHeight: 1.15,
    titleSize: 'clamp(1.9rem, 4.4vw, 3rem)',
    transform: 'none',
  },
  light: {
    bg: '#F3F1E7',
    bg2: '#E9E6D6',
    bg3: '#DDD9C4',
    text: '#1F2A1E',
    muted: '#4F5E48',
    dim: '#8A9580',
    accent: '#3F7A3A',
    accentRgb: '63 122 58',
    accentOnLight: '#3F7A3A',
    accentLo: 'rgb(63 122 58 / 0.08)',
    border: 'rgba(31, 42, 30, 0.12)',
    borderMd: 'rgba(31, 42, 30, 0.20)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#11160F',
    bg2: '#181E14',
    bg3: '#20281B',
    text: '#EDEFE2',
    muted: '#B2BBA0',
    dim: '#74806A',
    accent: '#7FB76B',
    accentRgb: '127 183 107',
    accentOnLight: '#3F7A3A',
    accentLo: 'rgb(127 183 107 / 0.12)',
    border: 'rgba(237, 239, 226, 0.12)',
    borderMd: 'rgba(237, 239, 226, 0.20)',
    colorScheme: 'dark',
  },
};
