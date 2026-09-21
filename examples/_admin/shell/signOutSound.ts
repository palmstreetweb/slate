/**
 * Sign-out farewell cue — "Letter fall" (gallery option 1).
 * Five descending ticks timed with the dissolving S-l-a-t-e letters.
 * Web Audio only; no asset files. Safe no-op if AudioContext is unavailable.
 */

'use client';

const NOTES = [784, 698, 659, 587, 523] as const;
const STEP_S = 0.09;
const NOTE_DUR_S = 0.16;
const GAIN = 0.14;

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

/** Play the five-note letter-fall cue. Call from a click handler. */
export function playSignOutLetterFall(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    void ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    NOTES.forEach((freq, i) => {
      tone(ctx, ctx.destination, t0 + i * STEP_S, freq);
    });
  } catch {
    // Audio blocked or unavailable — visual farewell still runs.
  }
}
