/**
 * Classic — calm, full-screen, conversational. A tribute to early Typeform:
 * one question at a time, clean neutral sans, soft rounded controls, a
 * friendly blue accent, and lots of whitespace. No decorations.
 *
 * Uses Inter at a medium weight and comfortable reading size — distinct from
 * the Swiss theme (Inter 900, lowercase, display-scale). Token values mirror
 * src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const classic: Theme = {
  name: 'Classic',
  tagline: 'Calm · full-screen · conversational',
  decoration: 'none',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '8px',
    borderWidth: '1.5px',
    titleWeight: 500,
    titleTracking: '-0.01em',
    titleLineHeight: 1.3,
    // Readable medium headline, not a dramatic display size — old Typeform
    // questions sat comfortably mid-viewport rather than shouting.
    titleSize: 'clamp(1.6rem, 3.6vw, 2.4rem)',
    transform: 'none',
  },
  light: {
    bg: '#FFFFFF',
    bg2: '#F5F7F9',
    bg3: '#ECEFF3',
    text: '#2B2E33',
    muted: '#62676E',
    dim: '#9AA0A6',
    accent: '#2C6EF2',
    accentRgb: '44 110 242',
    accentOnLight: '#2C6EF2',
    accentLo: 'rgb(44 110 242 / 0.08)',
    border: 'rgba(43, 46, 51, 0.12)',
    borderMd: 'rgba(43, 46, 51, 0.20)',
    colorScheme: 'light',
  },
  dark: {
    // Slatey charcoal rather than pure black — the classic Typeform dark feel.
    bg: '#2A2D34',
    bg2: '#313640',
    bg3: '#3A404B',
    text: '#F3F5F7',
    muted: '#B6BCC4',
    dim: '#828892',
    accent: '#5B9BFF',
    accentRgb: '91 155 255',
    accentOnLight: '#2C6EF2',
    accentLo: 'rgb(91 155 255 / 0.12)',
    border: 'rgba(243, 245, 247, 0.12)',
    borderMd: 'rgba(243, 245, 247, 0.20)',
    colorScheme: 'dark',
  },
};
