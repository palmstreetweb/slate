/**
 * Editorial — refined serif, warm cream.
 *
 * Aesthetic: newspaper editorial energy. Fraunces serif headlines,
 * JetBrains Mono labels, generous whitespace, subtle grain.
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const editorial: Theme = {
  name: 'Editorial',
  tagline: 'Refined serif · warm cream',
  decoration: 'grain',
  static: {
    fontDisplay: "'Fraunces', Georgia, serif",
    fontBody: "'Fraunces', Georgia, serif",
    fontMono: "'JetBrains Mono', monospace",
    radius: '3px',
    borderWidth: '1.5px',
    titleWeight: 500,
    titleTracking: '-0.025em',
    titleLineHeight: 1.08,
    titleSize: 'clamp(2rem, 5.2vw, 3.4rem)',
    transform: 'none',
  },
  light: {
    bg: '#FAF6EE',
    bg2: '#F4F0E5',
    bg3: '#EDE8DD',
    text: '#1A1A1A',
    muted: '#5B5851',
    dim: '#8E8B83',
    accent: '#2D5BFF',
    accentRgb: '45 91 255',
    accentOnLight: '#2D5BFF',
    accentLo: 'rgb(45 91 255 / 0.06)',
    border: 'rgba(26, 26, 26, 0.10)',
    borderMd: 'rgba(26, 26, 26, 0.18)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#14110D',
    bg2: '#1C1815',
    bg3: '#25201B',
    text: '#FAF6EE',
    muted: '#B8B2A4',
    dim: '#7A7468',
    accent: '#6E8FFF',
    accentRgb: '110 143 255',
    accentOnLight: '#2D5BFF',
    accentLo: 'rgb(110 143 255 / 0.10)',
    border: 'rgba(250, 246, 238, 0.08)',
    borderMd: 'rgba(250, 246, 238, 0.14)',
    colorScheme: 'dark',
  },
};
