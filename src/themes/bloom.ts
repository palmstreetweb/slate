/**
 * Bloom — a botanical theme with a *narrative* backdrop. A vine climbs one
 * segment per step and breaks into flower at the end (see GrowthDecoration).
 * Warm ivory paper, leaf-green ink, blush blossoms; serif display for an
 * organic, editorial-garden feel.
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const bloom: Theme = {
  name: 'Bloom',
  tagline: 'Botanical · the vine flowers as you finish',
  decoration: 'growth',
  static: {
    fontDisplay: "'Fraunces', 'Georgia', serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '14px',
    borderWidth: '1.5px',
    titleWeight: 500,
    titleTracking: '-0.01em',
    titleLineHeight: 1.15,
    titleSize: 'clamp(1.9rem, 4.2vw, 3rem)',
    transform: 'none',
  },
  light: {
    bg: '#FBF8F1',
    bg2: '#F3EEE2',
    bg3: '#E8E1D0',
    text: '#22321F',
    muted: '#566A4F',
    dim: '#9AA890',
    accent: '#4C8A4A',
    accentRgb: '76 138 74',
    accentOnLight: '#3C7A3A',
    accentLo: 'rgb(76 138 74 / 0.08)',
    border: 'rgba(34, 50, 31, 0.12)',
    borderMd: 'rgba(34, 50, 31, 0.20)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#10160F',
    bg2: '#172017',
    bg3: '#1F2B1E',
    text: '#EDF3E6',
    muted: '#A9BCA0',
    dim: '#6A7C62',
    accent: '#88C07E',
    accentRgb: '136 192 126',
    accentOnLight: '#3C7A3A',
    accentLo: 'rgb(136 192 126 / 0.12)',
    border: 'rgba(237, 243, 230, 0.12)',
    borderMd: 'rgba(237, 243, 230, 0.20)',
    colorScheme: 'dark',
  },
};
