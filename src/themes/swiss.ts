/**
 * Swiss — bold geometric, poster energy.
 *
 * Aesthetic: swissted.com. Archivo Black display, lowercase, sharp corners,
 * geometric SVG compositions in saturated primary palette behind each step.
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const swiss: Theme = {
  name: 'Swiss',
  tagline: 'Bold geometric · poster energy',
  decoration: 'shapes',
  static: {
    // Inter (variable, opsz axis) as a free Akzidenz-Grotesk substitute —
    // see DECISIONS.md ADR-009. Closer poster-grade letterforms than the
    // beta's Archivo Black; not the real Berthold typeface but the most
    // honest free approximation we can ship.
    fontDisplay: "'Inter', system-ui, sans-serif",
    fontBody: "'Inter', system-ui, sans-serif",
    fontMono: "'Inter', system-ui, sans-serif",
    radius: '0px',
    borderWidth: '2.5px',
    titleWeight: 900,
    titleTracking: '-0.035em',
    titleLineHeight: 0.95,
    titleSize: 'clamp(2.5rem, 6.2vw, 4.2rem)',
    transform: 'lowercase',
  },
  light: {
    bg: '#F2EFE3',
    bg2: '#E8E4D5',
    bg3: '#DDD8C6',
    text: '#000000',
    muted: '#2A2A2A',
    dim: '#6B6B6B',
    accent: '#DC2626',
    accentRgb: '220 38 38',
    accentOnLight: '#DC2626',
    accentLo: 'rgb(220 38 38 / 0.08)',
    border: 'rgba(0, 0, 0, 0.18)',
    borderMd: 'rgba(0, 0, 0, 0.28)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#0A0A0A',
    bg2: '#131313',
    bg3: '#1A1A1A',
    text: '#F2EFE3',
    muted: '#C8C8C8',
    dim: '#888888',
    accent: '#F87171',
    accentRgb: '248 113 113',
    accentOnLight: '#DC2626',
    accentLo: 'rgb(248 113 113 / 0.10)',
    border: 'rgba(242, 239, 227, 0.14)',
    borderMd: 'rgba(242, 239, 227, 0.22)',
    colorScheme: 'dark',
  },
};
