/**
 * Midnight — deep indigo night with soft aurora glows.
 *
 * Dark-first, calm and modern: medium-weight Inter, generous rounding, and
 * blurred indigo/violet blobs that drift behind each step (aurora decoration).
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const midnight: Theme = {
  name: 'Midnight',
  tagline: 'Indigo night · aurora glow',
  decoration: 'aurora',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '12px',
    borderWidth: '1.5px',
    titleWeight: 600,
    titleTracking: '-0.02em',
    titleLineHeight: 1.2,
    titleSize: 'clamp(1.8rem, 4vw, 2.8rem)',
    transform: 'none',
  },
  light: {
    bg: '#F4F4FB',
    bg2: '#ECECF7',
    bg3: '#E2E2F2',
    text: '#1B1B2E',
    muted: '#555573',
    dim: '#9494B0',
    accent: '#6366F1',
    accentRgb: '99 102 241',
    accentOnLight: '#6366F1',
    accentLo: 'rgb(99 102 241 / 0.08)',
    border: 'rgba(27, 27, 46, 0.10)',
    borderMd: 'rgba(27, 27, 46, 0.18)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#0E0E1A',
    bg2: '#15152A',
    bg3: '#1E1E38',
    text: '#ECECFF',
    muted: '#B0B0D8',
    dim: '#6E6E96',
    accent: '#818CF8',
    accentRgb: '129 140 248',
    accentOnLight: '#6366F1',
    accentLo: 'rgb(129 140 248 / 0.12)',
    border: 'rgba(236, 236, 255, 0.10)',
    borderMd: 'rgba(236, 236, 255, 0.18)',
    colorScheme: 'dark',
  },
};
