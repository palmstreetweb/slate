/**
 * Theme registry. Exported as `themes` from the public package barrel.
 * Adding a new built-in theme:
 *   1. Create src/themes/<name>.ts exporting a `Theme` config.
 *   2. Add it to the registry below.
 *   3. Mirror the values in src/styles/tokens.css.
 *   4. Add `<name>` to the ThemeName union in src/types/Theme.ts.
 */

import { classic } from './classic.js';
import { editorial } from './editorial.js';
import { swiss } from './swiss.js';
import { midnight } from './midnight.js';
import { sunset } from './sunset.js';
import { terminal } from './terminal.js';
import { forest } from './forest.js';
import { mono } from './mono.js';
import { constellation } from './constellation.js';
import { bloom } from './bloom.js';
import { riso } from './riso.js';
import { memphis } from './memphis.js';
import type { Theme, ThemeName } from '@/types/Theme.js';

export const themes: Record<ThemeName, Theme> = {
  classic,
  editorial,
  swiss,
  midnight,
  sunset,
  terminal,
  forest,
  mono,
  constellation,
  bloom,
  riso,
  memphis,
};

export {
  classic,
  editorial,
  swiss,
  midnight,
  sunset,
  terminal,
  forest,
  mono,
  constellation,
  bloom,
  riso,
  memphis,
};
