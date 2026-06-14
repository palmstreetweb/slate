/**
 * Constellation — a cosmic theme with a *narrative* backdrop. Each step lights
 * the next star and draws its connector, so completing the form completes the
 * star map (see ConstellationDecoration). Dark-first; the light mode is a pale
 * pre-dawn sky.
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const constellation: Theme = {
  name: 'Constellation',
  tagline: 'Cosmic · the star map completes as you go',
  decoration: 'constellation',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '10px',
    borderWidth: '1.5px',
    titleWeight: 600,
    titleTracking: '-0.02em',
    titleLineHeight: 1.2,
    titleSize: 'clamp(1.8rem, 4vw, 2.8rem)',
    transform: 'none',
  },
  light: {
    bg: '#F5F6FC',
    bg2: '#ECEEF8',
    bg3: '#E1E4F2',
    text: '#161A2E',
    muted: '#4E536E',
    dim: '#9094B0',
    accent: '#4F46E5',
    accentRgb: '79 70 229',
    accentOnLight: '#4338CA',
    accentLo: 'rgb(79 70 229 / 0.08)',
    border: 'rgba(22, 26, 46, 0.10)',
    borderMd: 'rgba(22, 26, 46, 0.18)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#07070F',
    bg2: '#0D0E1B',
    bg3: '#15172A',
    text: '#EAEDFF',
    muted: '#A6ABD6',
    dim: '#5E6390',
    accent: '#7DD3FC',
    accentRgb: '125 211 252',
    accentOnLight: '#4338CA',
    accentLo: 'rgb(125 211 252 / 0.12)',
    border: 'rgba(234, 237, 255, 0.10)',
    borderMd: 'rgba(234, 237, 255, 0.18)',
    colorScheme: 'dark',
  },
};
