/**
 * Theme types — config object shape, mode union, and token sets.
 *
 * A theme defines tokens for both light and dark modes plus typography/layout
 * tokens that are mode-invariant. See `BUILD_BRIEF.md` §8.4 + §9.
 */

/** Color tokens — defined per-mode (light + dark) in each theme. */
export type ThemeColorTokens = {
  bg: string;
  bg2: string;
  bg3: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  /** Same accent as space-separated RGB triple (for `rgb()` + alpha). */
  accentRgb: string;
  /** Deeper accent variant tuned for light mode. */
  accentOnLight: string;
  /** Accent at low alpha for backgrounds. */
  accentLo: string;
  border: string;
  borderMd: string;
  /** Native form-control color scheme. */
  colorScheme: 'light' | 'dark';
};

/** Typography + layout tokens — invariant across light/dark within a theme. */
export type ThemeStaticTokens = {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
  radius: string;
  borderWidth: string;
  titleWeight: number;
  titleTracking: string;
  titleLineHeight: number;
  titleSize: string;
  /** `'lowercase'` flips all rendered text to lowercase via `text-transform`. */
  transform: 'none' | 'lowercase';
};

/** A complete theme — name, tagline, static tokens, and per-mode color sets. */
export type Theme = {
  name: string;
  tagline: string;
  static: ThemeStaticTokens;
  light: ThemeColorTokens;
  dark: ThemeColorTokens;
  /** Optional decoration hint consumed by the renderer. */
  decoration?: 'none' | 'grain' | 'shapes';
};

/** Built-in theme registry keys. Extendable when more themes are added. */
export type ThemeName = 'editorial' | 'swiss';

/** Resolved theme mode at render time — never `'auto' | 'toggle'`. */
export type ResolvedThemeMode = 'light' | 'dark';

/** Mode selector consumers pass via `schema.themeMode`. */
export type ThemeMode = 'auto' | 'light' | 'dark' | 'toggle';
