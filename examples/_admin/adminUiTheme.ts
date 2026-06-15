/** Admin studio chrome palette — not form themes. */

export const ADMIN_UI_THEMES = ['warm', 'neutral', 'cool'] as const;
export type AdminUiTheme = (typeof ADMIN_UI_THEMES)[number];

export const ADMIN_UI_THEME_STORAGE_KEY = 'slate-ui-theme';

export type AdminUiThemeOption = {
  id: AdminUiTheme;
  label: string;
  description: string;
  /** Mini swatch colors for the settings picker (bg, panel, accent). */
  swatch: [string, string, string];
};

export const ADMIN_UI_THEME_OPTIONS: AdminUiThemeOption[] = [
  {
    id: 'warm',
    label: 'Warm',
    description: 'Parchment studio with the Slate red accent.',
    swatch: ['#f2efe8', '#ffffff', '#e23b2d'],
  },
  {
    id: 'neutral',
    label: 'Neutral',
    description: 'Minimal zinc grayscale for a quieter workspace.',
    swatch: ['#f4f4f5', '#ffffff', '#18181b'],
  },
  {
    id: 'cool',
    label: 'Cool',
    description: 'Blue-gray studio with a crisp blue accent.',
    swatch: ['#f0f4f8', '#ffffff', '#2563eb'],
  },
];

export function isAdminUiTheme(value: string): value is AdminUiTheme {
  return (ADMIN_UI_THEMES as readonly string[]).includes(value);
}

export function detectAdminUiTheme(): AdminUiTheme {
  if (typeof window === 'undefined') return 'warm';
  try {
    const stored = window.localStorage.getItem(ADMIN_UI_THEME_STORAGE_KEY);
    if (stored && isAdminUiTheme(stored)) return stored;
  } catch {
    // ignored
  }
  return 'warm';
}
