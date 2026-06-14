/**
 * Built-in form step sounds (ADR-023). Each id maps to a synthesized Web Audio
 * recipe — no asset files. `'off'` (or omitting `schema.sound`) means silent.
 */

/** Registry keys for the ten selectable step sounds. */
export type FormSoundId =
  | 'pixie-mallet'
  | 'soft-chime'
  | 'glass-tap'
  | 'wood-block'
  | 'bubble-pop'
  | 'coin-pickup'
  | 'page-flip'
  | 'type-ding'
  | 'marimba'
  | 'laser-blip';

/** Value stored on `schema.sound`. */
export type FormSound = 'off' | FormSoundId;
