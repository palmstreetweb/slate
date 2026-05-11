/**
 * Theme-folder local re-exports. The canonical types live in `src/types/Theme.ts`
 * (the public type surface). Internal callers can import from either; importing
 * from this file keeps theme code colocated.
 */

export type {
  Theme,
  ThemeName,
  ThemeMode,
  ResolvedThemeMode,
  ThemeColorTokens,
  ThemeStaticTokens,
} from '@/types/Theme.js';
