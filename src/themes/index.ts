/**
 * Theme registry. Exported as `themes` from the public package barrel.
 * Adding a new built-in theme:
 *   1. Create src/themes/<name>.ts exporting a `Theme` config.
 *   2. Add it to the registry below.
 *   3. Mirror the values in src/styles/tokens.css.
 *   4. Add `<name>` to the ThemeName union in src/types/Theme.ts.
 */

import { editorial } from './editorial.js';
import { swiss } from './swiss.js';
import type { Theme, ThemeName } from '@/types/Theme.js';

export const themes: Record<ThemeName, Theme> = {
  editorial,
  swiss,
};

export { editorial, swiss };
