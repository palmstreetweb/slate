/**
 * Studio settings that follow the account (ADR-073). On sign-in the account's
 * saved settings replace this device's; a device whose account has none
 * uploads its own. After that, every change the owner makes is uploaded
 * (debounced). Settings are cosmetic: any failure leaves the device as it is
 * and never blocks boot.
 */

import { getNeon } from './env.js';
import { ensureAuthForDataApi } from './ensureAuth.js';
import {
  PREFS_CHANGED_EVENT,
  applyPrefsLocally,
  prefsKey,
  readLocalPrefs,
  sanitizePrefs,
} from '../ownerPrefs.js';
import { UI_SCALE_EVENT } from '../uiScale.js';

const PULL_TIMEOUT_MS = 4_000;
const PUSH_DEBOUNCE_MS = 600;
/** Owner-made changes. Applying account settings also fires the scale/sounds events; prefsKey filters those out. */
const CHANGE_EVENTS = [PREFS_CHANGED_EVENT, UI_SCALE_EVENT, 'slate-admin-ui-sounds'] as const;

/** Whose settings this tab is syncing; null when not syncing. */
let syncedUserId: string | null = null;
/** What the account holds, as far as this tab knows. */
let lastSyncedKey: string | null = null;
let pushTimer: number | null = null;
let generation = 0;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`settings pull timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function pushNow(gen: number): Promise<void> {
  pushTimer = null;
  if (gen !== generation || !syncedUserId) return;
  const local = readLocalPrefs();
  const key = prefsKey(local);
  if (key === lastSyncedKey) return;
  try {
    await ensureAuthForDataApi();
    const { data, error } = await getNeon().rpc('set_owner_settings', { p_prefs: local });
    if (error) throw error;
    if (gen !== generation) return;
    lastSyncedKey = prefsKey(sanitizePrefs(data));
  } catch (err) {
    // The next change tries again; this device keeps the setting either way.
    console.warn('[slate] couldn’t save settings to your account:', err);
  }
}

function schedulePush(delay = PUSH_DEBOUNCE_MS): void {
  if (!syncedUserId) return;
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  const gen = generation;
  pushTimer = window.setTimeout(() => void pushNow(gen), delay);
}

const onChange = () => schedulePush();

function listen(on: boolean): void {
  for (const name of CHANGE_EVENTS) {
    window.removeEventListener(name, onChange);
    if (on) window.addEventListener(name, onChange);
  }
}

/**
 * Pull the account's settings onto this device and start uploading changes.
 * Never rejects.
 */
export async function syncOwnerSettings(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  stopOwnerSettingsSync();
  const gen = generation;
  try {
    await ensureAuthForDataApi();
    const { data, error } = await withTimeout(
      getNeon().rpc('get_owner_settings') as Promise<{ data: unknown; error: unknown }>,
      PULL_TIMEOUT_MS,
    );
    if (error) throw error;
    if (gen !== generation) return;
    const remote = sanitizePrefs(data);
    syncedUserId = userId;
    if (Object.keys(remote).length > 0) applyPrefsLocally(remote);
    lastSyncedKey = prefsKey(remote);
    // The first device for an account (or one with a setting the account lacks)
    // fills it in; when the account already has everything this is a no-op.
    schedulePush(0);
    listen(true);
  } catch (err) {
    // Before migration 024, offline, or slow: settings stay on this device.
    console.warn('[slate] settings sync skipped:', err);
  }
}

/** Stop syncing (sign-out, account switch). Leaves this device's settings as they are. */
export function stopOwnerSettingsSync(): void {
  generation += 1;
  if (typeof window !== 'undefined') listen(false);
  if (pushTimer !== null) window.clearTimeout(pushTimer);
  pushTimer = null;
  syncedUserId = null;
  lastSyncedKey = null;
}
