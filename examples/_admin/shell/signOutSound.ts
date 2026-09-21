/**
 * Auth farewell / welcome cues — Letter fall (sign-out) and Letter rise (sign-in).
 * Opposite five-note runs timed with dissolve / welcome. Web Audio only.
 */

'use client';

const FALL_NOTES = [784, 698, 659, 587, 523] as const;
/** Opposite of letter-fall — ascend into the studio. */
const RISE_NOTES = [523, 587, 659, 698, 784] as const;
const STEP_S = 0.09;
const NOTE_DUR_S = 0.16;
const GAIN = 0.14;

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  return sharedCtx;
}

function tone(ctx: AudioContext, dest: AudioNode, t0: number, freq: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(GAIN, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + NOTE_DUR_S);
  o.connect(g);
  g.connect(dest);
  o.start(t0);
  o.stop(t0 + NOTE_DUR_S + 0.05);
}

function playNotes(notes: readonly number[]): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    notes.forEach((freq, i) => {
      tone(ctx, ctx.destination, t0 + i * STEP_S, freq);
    });
  } catch {
    // Audio blocked — ignore.
  }
}

/** Descending ticks — sign-out word dissolve. */
export function playSignOutLetterFall(): void {
  playNotes(FALL_NOTES);
}

/** Ascending ticks — opposite of letter-fall, on successful sign-in. */
export function playSignInLetterRise(): void {
  playNotes(RISE_NOTES);
}
