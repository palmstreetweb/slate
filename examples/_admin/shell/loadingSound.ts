/**
 * Boot splash ident — "Open resolve" (Legend-adjacent option 1).
 * Reverse whoosh → sub hit → major fifth. Web Audio only; no assets.
 */

'use client';

let sharedCtx: AudioContext | null = null;
let playedThisBoot = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) sharedCtx = new AC();
  return sharedCtx;
}

function noiseBuf(ctx: AudioContext, dur: number): AudioBuffer {
  const n = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function whoosh(
  ctx: AudioContext,
  dest: AudioNode,
  t0: number,
  opts: { dur?: number; peak?: number; startF?: number; endF?: number } = {},
): void {
  const dur = opts.dur ?? 0.48;
  const peak = opts.peak ?? 0.075;
  const startF = opts.startF ?? 280;
  const endF = opts.endF ?? 2400;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(ctx, dur + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.85;
  f.frequency.setValueAtTime(endF, t0);
  f.frequency.exponentialRampToValueAtTime(startF, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.72);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function tone(
  ctx: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  opts: { type?: OscillatorType; peak?: number; a?: number; d?: number; r?: number } = {},
): void {
  const type = opts.type ?? 'sine';
  const peak = opts.peak ?? 0.05;
  const a = opts.a ?? 0.012;
  const d = opts.d ?? 0.35;
  const r = opts.r ?? 0.45;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.22), t + a + d);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + r);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + a + d + r + 0.05);
}

function sub(ctx: AudioContext, dest: AudioNode, t: number, freq: number, peak = 0.08): void {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.018);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.5);
}

/** Play once per page load. Returns false if blocked / already played / unavailable. */
export function playLoadingOpenResolve(): boolean {
  if (playedThisBoot) return false;
  try {
    const ctx = getCtx();
    if (!ctx) return false;
    void ctx.resume();
    if (ctx.state === 'suspended') return false;

    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    master.connect(lp).connect(ctx.destination);

    const hit = t0 + 0.38;
    whoosh(ctx, master, t0);
    sub(ctx, master, hit, 55, 0.09);
    tone(ctx, master, hit, 196, { peak: 0.045, d: 0.4, r: 0.55 });
    tone(ctx, master, hit + 0.03, 294, { peak: 0.05, d: 0.45, r: 0.7, type: 'triangle' });
    tone(ctx, master, hit + 0.05, 392, { peak: 0.028, d: 0.5, r: 0.8 });

    playedThisBoot = true;
    return true;
  } catch {
    return false;
  }
}

/** Allow a pending splash to retry after the first user gesture unlocks AudioContext. */
export function resetLoadingSoundGateForTests(): void {
  playedThisBoot = false;
}
