/**
 * The studio appearance settings that follow an owner's account (ADR-073):
 * color mode, UI theme, studio size, sounds. Each one still lives under its
 * own localStorage key (every reader stays as it was); this module reads them
 * as one object and writes a synced copy back. No SDK here.
 */

import { ADMIN_UI_THEME_STORAGE_KEY, isAdminUiTheme, type AdminUiTheme } from './adminUiTheme.js';
import { UI_SCALE_EVENT, UI_SCALE_KEY, applyUiScale, type UiScale } from './uiScale.js';
import { UI_SOUND_MUTE_KEY } from './uiSounds.js';

/** AdminShell's color-mode key. */
export const ADMIN_MODE_STORAGE_KEY = 'slate-theme';
/** Fired when the owner changes a setting (debounced upload listens). */
export const PREFS_CHANGED_EVENT = 'slate-prefs-changed';
/** Fired after account settings were written to this device (mounted shells re-read). */
export const PREFS_APPLIED_EVENT = 'slate-prefs-applied';

export type OwnerPrefs = {
  mode?: 'light' | 'dark';
  uiTheme?: AdminUiTheme;
  scale?: UiScale;
  sounds?: boolean;
};

/** Keep only known keys with known values. */
export function sanitizePrefs(raw: unknown): OwnerPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: OwnerPrefs = {};
  if (r.mode === 'light' || r.mode === 'dark') out.mode = r.mode;
  if (typeof r.uiTheme === 'string' && isAdminUiTheme(r.uiTheme)) out.uiTheme = r.uiTheme;
  if (r.scale === 1 || r.scale === 2 || r.scale === 3) out.scale = r.scale;
  if (typeof r.sounds === 'boolean') out.sounds = r.sounds;
  return out;
}

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * What this device uses. Mode and UI theme are left out until something stored
 * them; no size key is the default size and no sounds key is sounds on, the
 * same way their readers treat them.
 */
export function readLocalPrefs(): OwnerPrefs {
  if (typeof window === 'undefined') return {};
  const scale = get(UI_SCALE_KEY);
  return sanitizePrefs({
    mode: get(ADMIN_MODE_STORAGE_KEY),
    uiTheme: get(ADMIN_UI_THEME_STORAGE_KEY),
    scale: scale === '2' || scale === '3' ? Number(scale) : 1,
    sounds: get(UI_SOUND_MUTE_KEY) !== '0',
  });
}

/** Same settings → same string, whatever the key order. */
export function prefsKey(prefs: OwnerPrefs): string {
  const p = sanitizePrefs(prefs);
  return JSON.stringify([p.mode ?? null, p.uiTheme ?? null, p.scale ?? null, p.sounds ?? null]);
}

/** Write account settings to this device and tell whatever is mounted. */
export function applyPrefsLocally(prefs: OwnerPrefs): void {
  if (typeof window === 'undefined') return;
  const p = sanitizePrefs(prefs);
  try {
    if (p.mode) window.localStorage.setItem(ADMIN_MODE_STORAGE_KEY, p.mode);
    if (p.uiTheme) window.localStorage.setItem(ADMIN_UI_THEME_STORAGE_KEY, p.uiTheme);
    if (p.scale === 1) window.localStorage.removeItem(UI_SCALE_KEY);
    else if (p.scale) window.localStorage.setItem(UI_SCALE_KEY, String(p.scale));
    if (p.sounds !== undefined) window.localStorage.setItem(UI_SOUND_MUTE_KEY, p.sounds ? '1' : '0');
  } catch {
    // blocked storage: nothing to apply to
  }
  if (p.scale) {
    applyUiScale(p.scale);
    window.dispatchEvent(new CustomEvent(UI_SCALE_EVENT));
  }
  if (p.sounds !== undefined) window.dispatchEvent(new CustomEvent('slate-admin-ui-sounds'));
  window.dispatchEvent(new CustomEvent(PREFS_APPLIED_EVENT));
}

/** The owner changed a setting on this device. */
export function notifyPrefsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT));
}
