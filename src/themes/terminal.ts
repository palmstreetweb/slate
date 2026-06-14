/**
 * Terminal — monospace phosphor-green on near-black, blueprint grid.
 *
 * A coding-console aesthetic: everything in JetBrains Mono, sharp corners, a
 * bright green accent, and a faint technical line grid whose accent cell hops
 * to a new position each step (grid decoration).
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const terminal: Theme = {
  name: 'Terminal',
  tagline: 'Monospace · phosphor grid',
  decoration: 'grid',
  static: {
    fontDisplay: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    fontBody: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    radius: '2px',
    borderWidth: '1.5px',
    titleWeight: 600,
    titleTracking: '0em',
    titleLineHeight: 1.25,
    titleSize: 'clamp(1.5rem, 3.4vw, 2.3rem)',
    transform: 'none',
  },
  light: {
    bg: '#F2F4F0',
    bg2: '#E8EBE4',
    bg3: '#DCE0D6',
    text: '#13241B',
    muted: '#44604E',
    dim: '#8AA092',
    accent: '#0E8C44',
    accentRgb: '14 140 68',
    accentOnLight: '#0E8C44',
    accentLo: 'rgb(14 140 68 / 0.08)',
    border: 'rgba(19, 36, 27, 0.14)',
    borderMd: 'rgba(19, 36, 27, 0.24)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#0A0F0B',
    bg2: '#101810',
    bg3: '#18221A',
    text: '#C6F7D6',
    muted: '#6FB58A',
    dim: '#4A6E58',
    accent: '#36F58C',
    accentRgb: '54 245 140',
    accentOnLight: '#0E8C44',
    accentLo: 'rgb(54 245 140 / 0.12)',
    border: 'rgba(198, 247, 214, 0.12)',
    borderMd: 'rgba(198, 247, 214, 0.22)',
    colorScheme: 'dark',
  },
};
