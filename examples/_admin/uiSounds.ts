/**
 * Admin chrome UI sounds — short Web Audio cues for important clicks.
 * Separate from respondent form step sounds (ADR-023). No asset files.
 */

'use client';

import { playSound, type Recipe } from '@/utils/pixieMallet.js';
import { playLoadingOpenResolve } from './shell/loadingSound.js';
import { playSignInLetterRise, playSignOutLetterFall } from './shell/signOutSound.js';

/** localStorage — `0` mutes studio chrome (clicks, sign-in/out, boot ident). */
export const UI_SOUND_MUTE_KEY = 'slate-admin-ui-sounds';

export type UiSoundId =
  | 'tap'
  | 'create'
  | 'ai'
  | 'confirm'
  | 'danger'
  | 'success'
  | 'open'
  | 'copy'
  | 'refresh'
  | 'drop'
  | 'sign-out'
  | 'sign-in'
  | 'loading'
  | 'none';

export function isUiSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(UI_SOUND_MUTE_KEY) === '0';
  } catch {
    return false;
  }
}

export function setUiSoundMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UI_SOUND_MUTE_KEY, muted ? '0' : '1');
  } catch {
    // Quota / private mode — ignore.
  }
  window.dispatchEvent(new CustomEvent('slate-admin-ui-sounds'));
}
const RECIPES: Record<Exclude<UiSoundId, 'sign-out' | 'sign-in' | 'loading' | 'none'>, Recipe> = {
  tap: {
    duration: 0.06,
    layers: [
      {
        wave: 'triangle',
        gain: 0.07,
        freq: 720,
        ampEnv: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
        filter: { type: 'bandpass', freq: 1400, q: 2.2 },
      },
    ],
  },
  create: {
    duration: 0.18,
    layers: [
      {
        wave: 'sine',
        gain: 0.08,
        ampEnv: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.03 },
        repeat: { count: 2, interval: 0.055, pitchSeq: [523.25, 659.25] },
      },
    ],
  },
  ai: {
    duration: 0.28,
    layers: [
      {
        wave: 'sine',
        gain: 0.07,
        ampEnv: { attack: 0.004, decay: 0.16, sustain: 0, release: 0.04 },
        repeat: { count: 3, interval: 0.06, pitchSeq: [784, 988, 1175] },
      },
    ],
  },
  confirm: {
    duration: 0.16,
    layers: [
      {
        wave: 'triangle',
        gain: 0.09,
        ampEnv: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.03 },
        repeat: { count: 2, interval: 0.05, pitchSeq: [587, 784] },
      },
    ],
  },
  danger: {
    duration: 0.14,
    layers: [
      {
        wave: 'square',
        gain: 0.045,
        freq: 180,
        ampEnv: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 },
        filter: { type: 'lowpass', freq: 500, q: 0.8 },
      },
      {
        wave: 'triangle',
        gain: 0.05,
        freq: 220,
        ampEnv: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
      },
    ],
  },
  success: {
    duration: 0.22,
    layers: [
      {
        wave: 'sine',
        gain: 0.08,
        ampEnv: { attack: 0.003, decay: 0.14, sustain: 0, release: 0.04 },
        repeat: { count: 2, interval: 0.07, pitchSeq: [659.25, 880] },
      },
    ],
  },
  open: {
    duration: 0.12,
    layers: [
      {
        wave: 'sine',
        gain: 0.07,
        freq: 440,
        pitchEnv: { to: 660, time: 0.08, curve: 'exp' },
        ampEnv: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.02 },
      },
    ],
  },
  copy: {
    duration: 0.1,
    layers: [
      {
        wave: 'sine',
        gain: 0.07,
        freq: 990,
        ampEnv: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 },
      },
    ],
  },
  /** Three glass taps on the assemble-bar delays (drop wash). */
  drop: {
    duration: 0.5,
    layers: [
      {
        wave: 'sine',
        gain: 0.04,
        ampEnv: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.06 },
        filter: { type: 'bandpass', freq: 2400, q: 8 },
        repeat: { count: 3, interval: 0.12, pitchSeq: [1318.51, 1567.98, 1975.53] },
      },
    ],
  },
  /** Soft cycle — down then up, like a refresh spin settling. */
  refresh: {
    duration: 0.26,
    layers: [
      {
        wave: 'sine',
        gain: 0.065,
        ampEnv: { attack: 0.003, decay: 0.12, sustain: 0, release: 0.04 },
        repeat: { count: 3, interval: 0.055, pitchSeq: [587, 440, 698] },
      },
      {
        wave: 'triangle',
        gain: 0.035,
        freq: 880,
        pitchEnv: { to: 1320, time: 0.16, curve: 'exp' },
        ampEnv: { attack: 0.01, decay: 0.18, sustain: 0, release: 0.05 },
        filter: { type: 'highpass', freq: 600, q: 0.7 },
      },
    ],
  },
};

const VOLUME: Record<Exclude<UiSoundId, 'sign-out' | 'sign-in' | 'loading' | 'none'>, number> = {
  tap: 0.45,
  create: 0.55,
  ai: 0.5,
  confirm: 0.55,
  danger: 0.5,
  success: 0.55,
  open: 0.5,
  copy: 0.5,
  drop: 0.55,
  refresh: 0.5,
};

let lastPlayMs = 0;
const MIN_GAP_MS = 42;

export function playUiSound(id: UiSoundId, volumeScale = 1): void {
  if (id === 'none') return;
  if (typeof window === 'undefined') return;
  if (isUiSoundMuted()) return;
  const now = performance.now();
  if (id !== 'loading' && now - lastPlayMs < MIN_GAP_MS) return;
  if (id !== 'loading') lastPlayMs = now;

  try {
    if (id === 'sign-out') {
      playSignOutLetterFall();
      return;
    }
    if (id === 'sign-in') {
      playSignInLetterRise();
      return;
    }
    if (id === 'loading') {
      playLoadingOpenResolve();
      return;
    }
    playSound(VOLUME[id] * volumeScale, RECIPES[id]);
  } catch {
    // Audio blocked — ignore.
  }
}

function resolveAutoSound(el: HTMLElement): UiSoundId | null {
  const explicit = el.getAttribute('data-slate-sound') as UiSoundId | null;
  if (explicit) return explicit;

  if (el.classList.contains('slate-btn--danger-filled')) return 'danger';
  if (el.classList.contains('slate-btn--danger') && el.closest('.slate-dialog, .slate-card-footer')) {
    return 'danger';
  }
  if (el.classList.contains('slate-btn--new')) return 'create';
  if (el.querySelector('.slate-ai-sparkle')) return 'ai';

  const label = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
  if (label.includes('build with ai') || label.includes('generate')) return 'ai';
  if (label.includes('sign out')) return 'sign-out';
  if (label.includes('publish') && !label.includes('unpublish')) return 'confirm';
  if (label.includes('copy')) return 'copy';
  if (label.includes('restore') || label.includes('refresh') || label.includes('reload')) {
    return 'refresh';
  }
  if (label.includes('open in editor')) return 'success';
  if (label.includes('email me a link') || label.includes('continue with google')) return 'confirm';
  if (label.includes('move to trash') || label.includes('delete forever') || label.includes('empty trash')) {
    return 'danger';
  }

  // Primary CTAs — skip compact tabs / chips.
  if (
    el.classList.contains('slate-btn--primary') &&
    !el.classList.contains('slate-btn--compact')
  ) {
    return 'confirm';
  }

  if (el.classList.contains('slate-login-google') || el.classList.contains('slate-login-submit')) {
    return 'confirm';
  }
  if ((el.textContent || '').trim().toLowerCase() === 'sign in') return 'success';

  if (el.classList.contains('slate-card-icon-btn')) {
    if (el.classList.contains('slate-card-icon-btn--danger') || /trash|delete/i.test(label)) {
      return 'danger';
    }
    return 'tap';
  }

  return null;
}

/** Document-level click capture for important admin buttons (portals included). */
export function installAdminUiSounds(): () => void {
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // First gesture unlocks AudioContext — retry boot ident if splash is still up.
    if (document.querySelector('.slate-loading')) {
      playUiSound('loading');
    }
    const raw = e.target;
    if (!(raw instanceof Element)) return;
    const el = raw.closest(
      'button, [role="button"], a.slate-btn, .slate-card-icon-btn',
    ) as HTMLElement | null;
    if (!el) return;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return;
    // Sign-out farewell is timed with the overlay in useSignOutFlow — skip here.
    if ((el.textContent || '').trim().toLowerCase().includes('sign out')) return;
    if (el.getAttribute('data-slate-sound') === 'sign-out') return;

    const id = resolveAutoSound(el);
    if (id && id !== 'none') playUiSound(id);
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}
