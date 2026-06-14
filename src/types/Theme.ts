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
  /**
   * Optional decoration hint consumed by the renderer. All except `grain`
   * vary per question step (the step index is passed to the component).
   *
   * Recomposing decorations (a different scene each step):
   *   - `shapes` — Swiss geometric poster compositions
   *   - `aurora` — soft glowing gradient blobs (gradient/dark themes)
   *   - `grid`   — technical line grid with a per-step accent cell
   *   - `riso`   — duotone halftone blobs with print misregistration
   *   - `memphis`— playful 80s squiggles, zigzags, and shapes
   *
   * Narrative decorations (cumulative — the picture *builds* as you advance):
   *   - `constellation` — each step lights a new star and draws its connector,
   *     so finishing the form completes the star map
   *   - `growth` — a vine grows one segment per step and flowers at the end
   *
   * Static (no per-step variation):
   *   - `grain` — static fractal-noise texture
   */
  decoration?:
    | 'none'
    | 'grain'
    | 'shapes'
    | 'aurora'
    | 'grid'
    | 'riso'
    | 'memphis'
    | 'constellation'
    | 'growth';
};

/** Built-in theme registry keys. Extendable when more themes are added. */
export type ThemeName =
  | 'classic'
  | 'editorial'
  | 'swiss'
  | 'midnight'
  | 'sunset'
  | 'terminal'
  | 'forest'
  | 'mono'
  | 'constellation'
  | 'bloom'
  | 'riso'
  | 'memphis';

/** Resolved theme mode at render time — never `'auto' | 'toggle'`. */
export type ResolvedThemeMode = 'light' | 'dark';

/** Mode selector consumers pass via `schema.themeMode`. */
export type ThemeMode = 'auto' | 'light' | 'dark' | 'toggle';
