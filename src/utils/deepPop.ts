/**
 * #194 "Deep Pop" — a synthesized UI sound (Web Audio, no audio files,
 * zero dependencies). Recipe values are tuned — do not change them;
 * `volume` (0–1) is the only knob.
 *
 * Used by the admin outline when a grabbed question card is dropped.
 * Browsers require a user gesture; playback is triggered from pointerup
 * after a drag.
 */

import { playSound, type Recipe } from '@/utils/pixieMallet.js';

export const SOUND_194_DEEP_POP = {
  duration: 0.12,
  layers: [
    {
      type: 'osc',
      wave: 'sine',
      freq: 180,
      gain: 0.2,
      pitchEnv: {
        to: 320,
        time: 0.08,
      },
      ampEnv: {
        attack: 0.003,
        decay: 0.09,
        sustain: 0,
        release: 0.02,
      },
    },
  ],
} as const satisfies Recipe;

export function playDeepPop(volume = 0.8): void {
  playSound(volume, SOUND_194_DEEP_POP);
}
