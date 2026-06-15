/**
 * #1275 "Send Pip" — a synthesized UI sound (Web Audio, no audio files,
 * zero dependencies). Recipe values are tuned — do not change them;
 * `volume` (0–1) is the only knob.
 *
 * Used by the admin outline when a question card is grabbed to reorder.
 * Browsers require a user gesture; playback is triggered from pointerdown
 * on the outline row.
 */

import { playSound, type Recipe } from '@/utils/pixieMallet.js';

export const SOUND_1275_SEND_PIP = {
  duration: 0.13,
  layers: [
    {
      type: 'osc',
      wave: 'sine',
      freq: 880,
      gain: 0.1,
      pitchEnv: {
        to: 1480,
        time: 0.1,
      },
      ampEnv: {
        attack: 0.002,
        decay: 0.1,
        sustain: 0,
        release: 0.02,
      },
    },
  ],
} as const satisfies Recipe;

export function playSendPip(volume = 0.8): void {
  playSound(volume, SOUND_1275_SEND_PIP);
}
