/**
 * Sunset — warm coral-to-amber with soft aurora glows.
 *
 * Friendly and warm: medium-weight Inter, rounded controls, and blurred
 * coral/amber/pink blobs that shift behind each step (aurora decoration).
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const sunset: Theme = {
  name: 'Sunset',
  tagline: 'Warm coral · amber glow',
  decoration: 'aurora',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '14px',
    borderWidth: '1.5px',
    titleWeight: 600,
    titleTracking: '-0.02em',
    titleLineHeight: 1.2,
    titleSize: 'clamp(1.8rem, 4vw, 2.8rem)',
    transform: 'none',
  },
  light: {
    bg: '#FFF8F2',
    bg2: '#FDEEE2',
    bg3: '#FAE2CF',
    text: '#3A2018',
    muted: '#7A4A38',
    dim: '#B08470',
    accent: '#E2552B',
    accentRgb: '226 85 43',
    accentOnLight: '#E2552B',
    accentLo: 'rgb(226 85 43 / 0.08)',
    border: 'rgba(58, 32, 24, 0.12)',
    borderMd: 'rgba(58, 32, 24, 0.20)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#1E1012',
    bg2: '#2A161A',
    bg3: '#371D22',
    text: '#FFEDE3',
    muted: '#D9A892',
    dim: '#9C6A58',
    accent: '#FF8A5C',
    accentRgb: '255 138 92',
    accentOnLight: '#E2552B',
    accentLo: 'rgb(255 138 92 / 0.12)',
    border: 'rgba(255, 237, 227, 0.12)',
    borderMd: 'rgba(255, 237, 227, 0.20)',
    colorScheme: 'dark',
  },
};
