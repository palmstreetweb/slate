/**
 * Riso — a risograph-print theme: paper stock, bold grotesque type, and a
 * duotone halftone backdrop whose two inks overprint and mis-register the way
 * a real two-pass riso does (see RisoDecoration). Pink + blue inks in light,
 * brighter inks over near-black in dark.
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const riso: Theme = {
  name: 'Riso',
  tagline: 'Risograph · duotone halftone overprint',
  decoration: 'riso',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '4px',
    borderWidth: '2px',
    titleWeight: 800,
    titleTracking: '-0.03em',
    titleLineHeight: 1.1,
    titleSize: 'clamp(1.9rem, 4.4vw, 3rem)',
    transform: 'none',
  },
  light: {
    bg: '#FBF6EC',
    bg2: '#F4EEDF',
    bg3: '#EBE3CF',
    text: '#1A1A1A',
    muted: '#5A5246',
    dim: '#9C9484',
    accent: '#E23472',
    accentRgb: '226 52 114',
    accentOnLight: '#E23472',
    accentLo: 'rgb(226 52 114 / 0.08)',
    border: 'rgba(26, 26, 26, 0.16)',
    borderMd: 'rgba(26, 26, 26, 0.30)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#121012',
    bg2: '#1A171A',
    bg3: '#241F24',
    text: '#F4EFE6',
    muted: '#BCB2A6',
    dim: '#7A7064',
    accent: '#FF6FA3',
    accentRgb: '255 111 163',
    accentOnLight: '#E23472',
    accentLo: 'rgb(255 111 163 / 0.14)',
    border: 'rgba(244, 239, 230, 0.16)',
    borderMd: 'rgba(244, 239, 230, 0.30)',
    colorScheme: 'dark',
  },
};
