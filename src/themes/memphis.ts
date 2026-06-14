/**
 * Memphis — a playful 1980s "Memphis Group" theme: bright paper, chunky type,
 * generous rounding, and a backdrop of squiggles, zigzags, arcs, triangles and
 * dot grids scattered around the edges (see MemphisDecoration).
 *
 * Token values mirror src/styles/tokens.css. If you change one, change both.
 */

import type { Theme } from '@/types/Theme.js';

export const memphis: Theme = {
  name: 'Memphis',
  tagline: 'Playful 80s · squiggles & confetti shapes',
  decoration: 'memphis',
  static: {
    fontDisplay: "'Inter', system-ui, -apple-system, sans-serif",
    fontBody: "'Inter', system-ui, -apple-system, sans-serif",
    fontMono: "'JetBrains Mono', ui-monospace, monospace",
    radius: '16px',
    borderWidth: '2px',
    titleWeight: 800,
    titleTracking: '-0.02em',
    titleLineHeight: 1.12,
    titleSize: 'clamp(1.9rem, 4.4vw, 3rem)',
    transform: 'none',
  },
  light: {
    bg: '#FDFBF6',
    bg2: '#F6F2EA',
    bg3: '#ECE6DA',
    text: '#1C1C28',
    muted: '#5B5B6E',
    dim: '#9A9AAC',
    accent: '#FF3D7F',
    accentRgb: '255 61 127',
    accentOnLight: '#E22468',
    accentLo: 'rgb(255 61 127 / 0.08)',
    border: 'rgba(28, 28, 40, 0.14)',
    borderMd: 'rgba(28, 28, 40, 0.26)',
    colorScheme: 'light',
  },
  dark: {
    bg: '#16121E',
    bg2: '#1E1929',
    bg3: '#282234',
    text: '#F5F0FF',
    muted: '#B8AECC',
    dim: '#766C88',
    accent: '#FF6FA3',
    accentRgb: '255 111 163',
    accentOnLight: '#E22468',
    accentLo: 'rgb(255 111 163 / 0.14)',
    border: 'rgba(245, 240, 255, 0.14)',
    borderMd: 'rgba(245, 240, 255, 0.26)',
    colorScheme: 'dark',
  },
};
