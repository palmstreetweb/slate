/**
 * Form step-sound registry — ten synthesized presets plus `off`.
 *
 * The recipes and the Web Audio engine (`formSoundsSynth.ts`, `pixieMallet.ts`)
 * load on demand: `<Form>` starts the download on mount when the form's sound
 * is on, so the first step plays at once, and a form with its sound off never
 * fetches them (engine budget, audit 2026-10). Volume (0–1) is the only
 * runtime knob.
 */

import type { FormSound, FormSoundId } from '@/types/Sound.js';
import type * as Synth from './formSoundsSynth.js';

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

/** Normalize legacy `sound: true` (pre-dropdown) to the default preset. */
export function resolveFormSound(raw: unknown): FormSound {
  if (raw === true) return 'pixie-mallet';
  if (raw !== 'off' && FORM_SOUND_OPTIONS.some((o) => o.value === raw)) return raw as FormSoundId;
  return 'off';
}

let synth: typeof Synth | undefined;
let loading: Promise<typeof Synth> | undefined;

/** Start loading the synth; resolves once it can play (never rejects). */
export function preloadFormSounds(): Promise<unknown> {
  loading ??= import('./formSoundsSynth.js').then((m) => (synth = m));
  return loading.catch(() => {});
}

/** Play now when the synth is here, else as soon as it lands (a download that fails stays silent). */
function withSynth(play: (m: typeof Synth) => void): void {
  if (synth) play(synth);
  else void preloadFormSounds().then(() => synth && play(synth));
}

/** Play a built-in step sound, or no-op when `off`. */
export function playFormSound(sound: FormSound | boolean | undefined, volume = 0.6): void {
  const id = resolveFormSound(sound);
  if (id !== 'off') withSynth((m) => m.playStep(id, volume));
}

/** Play one typewriter key tick (quieter than step sounds; rate-limited in the synth). */
export function playTypewriterTick(volume = 0.34): void {
  withSynth((m) => m.playTick(volume));
}

/** Play the completion finale for a form whose sound is on; no-op when `off`. */
export function playFormFinale(sound: FormSound | boolean | undefined, volume = 0.55): void {
  if (resolveFormSound(sound) !== 'off') withSynth((m) => m.playFinale(volume));
}
