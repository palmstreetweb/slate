/**
 * ADR-073: studio settings follow the account. The account's settings win at
 * sign-in, an empty account takes this device's, owner changes upload once
 * (debounced), applying account settings never echoes back, and failures
 * leave the device alone without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('../examples/_admin/neon/env.js', () => ({
  getNeon: () => ({ rpc }),
}));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({
  ensureAuthForDataApi: async () => ({ accessToken: 't', email: 'o@example.com' }),
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({
  UI_SOUND_MUTE_KEY: 'slate-admin-ui-sounds',
}));

import {
  applyPrefsLocally,
  notifyPrefsChanged,
  prefsKey,
  readLocalPrefs,
  sanitizePrefs,
} from '../examples/_admin/ownerPrefs.js';
import { stopOwnerSettingsSync, syncOwnerSettings } from '../examples/_admin/neon/settingsRemote.js';
import { writeUiScale } from '../examples/_admin/uiScale.js';

function setCalls() {
  return rpc.mock.calls.filter(([name]) => name === 'set_owner_settings');
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  delete document.body.dataset.slateScale;
  rpc.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  stopOwnerSettingsSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ownerPrefs', () => {
  it('keeps only known keys with known values', () => {
    expect(
      sanitizePrefs({ mode: 'dark', uiTheme: 'cool', scale: 3, sounds: false, evil: '<x>' }),
    ).toEqual({ mode: 'dark', uiTheme: 'cool', scale: 3, sounds: false });
    expect(sanitizePrefs({ mode: 'pink', uiTheme: 'x', scale: 9, sounds: 'no' })).toEqual({});
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs([1])).toEqual({});
  });

  it('reads defaults the way their readers do', () => {
    expect(readLocalPrefs()).toEqual({ scale: 1, sounds: true });
    window.localStorage.setItem('slate-theme', 'light');
    window.localStorage.setItem('slate-ui-theme', 'neutral');
    window.localStorage.setItem('slate-admin-ui-scale', '2');
    window.localStorage.setItem('slate-admin-ui-sounds', '0');
    expect(readLocalPrefs()).toEqual({ mode: 'light', uiTheme: 'neutral', scale: 2, sounds: false });
  });

  it('writes every key and applies the size', () => {
    applyPrefsLocally({ mode: 'dark', uiTheme: 'cool', scale: 3, sounds: false });
    expect(window.localStorage.getItem('slate-theme')).toBe('dark');
    expect(window.localStorage.getItem('slate-ui-theme')).toBe('cool');
    expect(window.localStorage.getItem('slate-admin-ui-scale')).toBe('3');
    expect(window.localStorage.getItem('slate-admin-ui-sounds')).toBe('0');
    expect(document.body.dataset.slateScale).toBe('3');
    applyPrefsLocally({ scale: 1 });
    expect(window.localStorage.getItem('slate-admin-ui-scale')).toBeNull();
  });

  it('compares regardless of key order', () => {
    expect(prefsKey({ mode: 'dark', scale: 2 })).toBe(prefsKey({ scale: 2, mode: 'dark' }));
  });
});

describe('syncOwnerSettings', () => {
  it('replaces this device’s settings with the account’s, and uploads nothing new', async () => {
    window.localStorage.setItem('slate-theme', 'light');
    const remote = { mode: 'dark', uiTheme: 'cool', scale: 2, sounds: false };
    rpc.mockResolvedValueOnce({ data: remote, error: null });
    await syncOwnerSettings('u1');
    expect(readLocalPrefs()).toEqual(remote);
    await vi.runAllTimersAsync();
    expect(setCalls()).toHaveLength(0);
  });

  it('gives an empty account this device’s settings', async () => {
    window.localStorage.setItem('slate-theme', 'light');
    window.localStorage.setItem('slate-ui-theme', 'neutral');
    rpc.mockImplementation(async (name: string, args?: { p_prefs: unknown }) =>
      name === 'get_owner_settings' ? { data: null, error: null } : { data: args?.p_prefs, error: null },
    );
    await syncOwnerSettings('u1');
    await vi.runAllTimersAsync();
    expect(setCalls()).toEqual([
      ['set_owner_settings', { p_prefs: { mode: 'light', uiTheme: 'neutral', scale: 1, sounds: true } }],
    ]);
  });

  it('uploads an owner’s change once, debounced, and only when it differs', async () => {
    rpc.mockImplementation(async (name: string, args?: { p_prefs: unknown }) =>
      name === 'get_owner_settings'
        ? { data: { mode: 'dark', uiTheme: 'warm', scale: 1, sounds: true }, error: null }
        : { data: args?.p_prefs, error: null },
    );
    await syncOwnerSettings('u1');
    await vi.runAllTimersAsync();
    expect(setCalls()).toHaveLength(0);

    writeUiScale(3);
    window.localStorage.setItem('slate-theme', 'light');
    notifyPrefsChanged();
    await vi.advanceTimersByTimeAsync(100);
    expect(setCalls()).toHaveLength(0);
    await vi.runAllTimersAsync();
    expect(setCalls()).toEqual([
      ['set_owner_settings', { p_prefs: { mode: 'light', uiTheme: 'warm', scale: 3, sounds: true } }],
    ]);

    // Same settings again: nothing to send.
    notifyPrefsChanged();
    await vi.runAllTimersAsync();
    expect(setCalls()).toHaveLength(1);
  });

  it('stops uploading after sign-out', async () => {
    rpc.mockResolvedValue({ data: { mode: 'dark' }, error: null });
    await syncOwnerSettings('u1');
    await vi.runAllTimersAsync();
    rpc.mockClear();
    stopOwnerSettingsSync();
    writeUiScale(2);
    await vi.runAllTimersAsync();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('leaves the device alone when the database has no settings yet (before 024)', async () => {
    window.localStorage.setItem('slate-theme', 'light');
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    await expect(syncOwnerSettings('u1')).resolves.toBeUndefined();
    expect(window.localStorage.getItem('slate-theme')).toBe('light');
    writeUiScale(2);
    await vi.runAllTimersAsync();
    expect(setCalls()).toHaveLength(0);
  });

  it('gives up on a slow pull without blocking boot', async () => {
    rpc.mockImplementation(() => new Promise(() => {}));
    const done = syncOwnerSettings('u1');
    await vi.advanceTimersByTimeAsync(4_100);
    await expect(done).resolves.toBeUndefined();
  });

  it('keeps the setting when an upload fails, and retries on the next change', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'get_owner_settings'
        ? { data: { mode: 'dark', scale: 1, sounds: true }, error: null }
        : { data: null, error: { message: 'offline' } },
    );
    await syncOwnerSettings('u1');
    await vi.runAllTimersAsync();
    const before = setCalls().length;
    writeUiScale(2);
    await vi.runAllTimersAsync();
    expect(window.localStorage.getItem('slate-admin-ui-scale')).toBe('2');
    notifyPrefsChanged();
    await vi.runAllTimersAsync();
    expect(setCalls().length).toBe(before + 2);
  });
});
