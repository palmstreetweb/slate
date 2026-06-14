/**
 * Form step-sound registry — ten synthesized presets plus `off`.
 *
 * Recipes run through the generic engine in `pixieMallet.ts` (Web Audio, zero
 * deps). Pixie Mallet's tuned recipe lives in that module; the other nine are
 * defined here. Volume (0–1) is the only runtime knob.
 */

import type { FormSound, FormSoundId } from '@/types/Sound.js';
import { playSound, SOUND_711_PIXIE_MALLET, type Recipe } from '@/utils/pixieMallet.js';

/** Dropdown labels for Slate Settings panel and public docs. */
export const FORM_SOUND_OPTIONS: ReadonlyArray<{ value: FormSound; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'pixie-mallet', label: 'Pixie Mallet' },
  { value: 'soft-chime', label: 'Soft Chime' },
  { value: 'glass-tap', label: 'Glass Tap' },
  { value: 'wood-block', label: 'Wood Block' },
  { value: 'bubble-pop', label: 'Bubble Pop' },
  { value: 'coin-pickup', label: 'Coin Pickup' },
  { value: 'page-flip', label: 'Page Flip' },
  { value: 'type-ding', label: 'Typewriter Ding' },
  { value: 'marimba', label: 'Marimba Step' },
  { value: 'laser-blip', label: 'Laser Blip' },
];

const RECIPES: Record<FormSoundId, Recipe> = {
  'pixie-mallet': SOUND_711_PIXIE_MALLET,
  'soft-chime': {
    duration: 0.5,
    layers: [
      {
        wave: 'sine',
        gain: 0.08,
        freq: 1046.5,
        ampEnv: { attack: 0.005, decay: 0.35, sustain: 0, release: 0.08 },
      },
    ],
  },
  'glass-tap': {
    duration: 0.2,
    layers: [
      {
        wave: 'sine',
        gain: 0.06,
        freq: 1318.51,
        ampEnv: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.03 },
        filter: { type: 'bandpass', freq: 2000, q: 8 },
      },
    ],
  },
  'wood-block': {
    duration: 0.1,
    layers: [
      {
        wave: 'triangle',
        gain: 0.12,
        freq: 180,
        ampEnv: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.01 },
      },
    ],
  },
  'bubble-pop': {
    duration: 0.14,
    layers: [
      {
        wave: 'sine',
        gain: 0.09,
        freq: 600,
        pitchEnv: { to: 200, time: 0.08, curve: 'exp' },
        ampEnv: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
      },
    ],
  },
  'coin-pickup': {
    duration: 0.18,
    layers: [
      {
        wave: 'square',
        gain: 0.05,
        ampEnv: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
        repeat: { count: 2, interval: 0.06, pitchSeq: [987.77, 1318.51] },
      },
    ],
  },
  'page-flip': {
    duration: 0.28,
    layers: [
      {
        wave: 'triangle',
        gain: 0.05,
        freq: 800,
        pitchEnv: { to: 300, time: 0.15, curve: 'exp' },
        ampEnv: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.05 },
      },
    ],
  },
  'type-ding': {
    duration: 0.35,
    layers: [
      {
        type: 'fm',
        wave: 'sine',
        gain: 0.06,
        freq: 880,
        fm: { modWave: 'sine', ratio: 2.5, index: 3 },
        ampEnv: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.06 },
      },
    ],
  },
  marimba: {
    duration: 0.28,
    layers: [
      {
        wave: 'sine',
        gain: 0.07,
        ampEnv: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.03 },
        repeat: { count: 3, interval: 0.07, pitchSeq: [523.25, 392, 293.66] },
      },
    ],
  },
  'laser-blip': {
    duration: 0.1,
    layers: [
      {
        wave: 'saw',
        gain: 0.04,
        freq: 220,
        pitchEnv: { to: 1760, time: 0.06, curve: 'exp' },
        ampEnv: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.01 },
      },
    ],
  },
};

/** Normalize legacy `sound: true` (pre-dropdown) to the default preset. */
export function resolveFormSound(raw: unknown): FormSound {
  if (raw === true) return 'pixie-mallet';
  if (raw === false || raw == null || raw === 'off') return 'off';
  if (typeof raw === 'string' && raw in RECIPES) return raw as FormSoundId;
  return 'off';
}

/** Play a built-in step sound, or no-op when `off`. */
export function playFormSound(sound: FormSound | boolean | undefined, volume = 0.6): void {
  const id = resolveFormSound(sound);
  if (id === 'off') return;
  playSound(volume, RECIPES[id]);
}
