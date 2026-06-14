/**
 * Applies a theme's tokens to a wrapper element.
 *
 * For built-in themes (`editorial`, `swiss`), the static rules in
 * `src/styles/tokens.css` already cover both modes — calling this with a
 * built-in theme is a no-op aside from setting the `data-theme-name` /
 * `data-theme` attributes that drive those rules.
 *
 * For custom themes registered at runtime, this writes every token as an
 * inline CSS custom property on the wrapper so consumers don't need to ship
 * additional CSS.
 */

import type { Theme, ThemeName, ResolvedThemeMode } from '@/types/Theme.js';
import { themes as builtinThemes } from '@/themes/index.js';

const STATIC_TOKEN_MAP: ReadonlyArray<[keyof Theme['static'], string]> = [
  ['fontDisplay', '--slate-font-display'],
  ['fontBody', '--slate-font-body'],
  ['fontMono', '--slate-font-mono'],
  ['radius', '--slate-radius'],
  ['borderWidth', '--slate-border-width'],
  ['titleWeight', '--slate-title-weight'],
  ['titleTracking', '--slate-title-tracking'],
  ['titleLineHeight', '--slate-title-line-height'],
  ['titleSize', '--slate-title-size'],
  ['transform', '--slate-transform'],
];

const COLOR_TOKEN_MAP: ReadonlyArray<[keyof Theme['light'], string]> = [
  ['bg', '--slate-bg'],
  ['bg2', '--slate-bg-2'],
  ['bg3', '--slate-bg-3'],
  ['text', '--slate-text'],
  ['muted', '--slate-muted'],
  ['dim', '--slate-dim'],
  ['accent', '--slate-accent'],
  ['accentRgb', '--slate-accent-rgb'],
  ['accentOnLight', '--slate-accent-on-light'],
  ['accentLo', '--slate-accent-lo'],
  ['border', '--slate-border'],
  ['borderMd', '--slate-border-md'],
];

function isBuiltin(name: string): name is ThemeName {
  return name in builtinThemes;
}

/**
 * Set theme + mode on a wrapper element. For built-in themes, just sets data
 * attributes (the static CSS does the rest). For custom themes, also writes
 * every token value as an inline CSS variable.
 */
export function applyTheme(
  wrapper: HTMLElement,
  themeNameOrTheme: string | Theme,
  mode: ResolvedThemeMode,
): void {
  if (typeof themeNameOrTheme === 'string') {
    wrapper.dataset.themeName = themeNameOrTheme;
    wrapper.dataset.theme = mode;
    if (!isBuiltin(themeNameOrTheme)) {
      // Unknown theme name with no value object — caller is expected to also
      // ship CSS that targets [data-theme-name="<name>"]. Nothing else to do.
    }
    return;
  }

  // Custom Theme object: write every token inline.
  wrapper.dataset.themeName = themeNameOrTheme.name.toLowerCase();
  wrapper.dataset.theme = mode;

  for (const [key, cssVar] of STATIC_TOKEN_MAP) {
    wrapper.style.setProperty(cssVar, String(themeNameOrTheme.static[key]));
  }
  const colors = themeNameOrTheme[mode];
  for (const [key, cssVar] of COLOR_TOKEN_MAP) {
    wrapper.style.setProperty(cssVar, colors[key]);
  }
  wrapper.style.setProperty('color-scheme', colors.colorScheme);
}

/** Read the host page's `<html data-theme>` if present — used on first mount. */
export function readHostTheme(): ResolvedThemeMode | undefined {
  if (typeof document === 'undefined') return undefined;
  const v = document.documentElement.dataset.theme;
  if (v === 'light' || v === 'dark') return v;
  return undefined;
}
