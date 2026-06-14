/**
 * #711 "Pixie Mallet" — a synthesized UI sound (Web Audio, no audio files,
 * zero dependencies). A faithful TypeScript port of the provided recipe +
 * generic synth engine. The recipe values are tuned — do not change them;
 * `volume` (0–1) is the only knob.
 *
 * Used as the per-step confirmation cue when `schema.sound` is on (ADR-023).
 * Browsers require a user gesture for audio; playback is triggered from a
 * click/Enter-driven navigation, so the lazily-created AudioContext unlocks.
 *
 * Not DOM — never touches the host page's `<html>`/`<body>` (wrapper-scoped).
 */

export const SOUND_711_PIXIE_MALLET = {
  duration: 0.4,
  layers: [
    {
      type: 'osc',
      wave: 'triangle',
      gain: 0.07,
      ampEnv: {
        attack: 0.002,
        decay: 0.18,
        sustain: 0,
        release: 0.02,
      },
      repeat: {
        count: 3,
        interval: 0.08,
        pitchSeq: [1318.51, 1760, 2093],
      },
    },
  ],
} as const satisfies Recipe;

/* ---------- recipe shape ---------- */

type AmpEnv = { attack: number; decay: number; sustain: number; release: number };
type PitchEnv = { to: number; time: number; curve?: 'lin' | 'exp' };
type FilterEnv = { to: number; time: number };
type LayerFilter = { type: BiquadFilterType; freq: number; q?: number; env?: FilterEnv };
type FM = { modWave?: string; ratio: number; index: number };
type Repeat = {
  count: number;
  interval: number;
  pitchSeq?: readonly number[];
  pitchPool?: readonly number[];
  pitchStep?: number;
};
type Layer = {
  type?: string;
  wave?: string;
  gain: number;
  ampEnv: AmpEnv;
  freq?: number;
  detune?: number;
  startOffset?: number;
  pan?: number;
  pitchEnv?: PitchEnv;
  fm?: FM;
  filter?: LayerFilter;
  repeat?: Repeat;
};
export type Recipe = { duration: number; layers: readonly Layer[] };

type WindowWithWebkitAudio = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let _sndCtx: AudioContext | null = null;

/** Lazily get a shared AudioContext, or null when Web Audio is unavailable. */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithWebkitAudio;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!_sndCtx) {
    try {
      _sndCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return _sndCtx;
}

export function playSound(volume = 0.8, recipe: Recipe = SOUND_711_PIXIE_MALLET): void {
  const ac = getContext();
  if (!ac) return;
  void ac.resume();

  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  const bus = ac.createGain();
  const t0 = ac.currentTime + 0.005;
  const FLOOR = 0.0001;
  const wave = (w?: string): OscillatorType =>
    w === 'saw' ? 'sawtooth' : ((w as OscillatorType) || 'sine');
  bus.connect(out);

  const voice = (layer: Layer, freq: number, at: number): void => {
    const env = layer.ampEnv;
    const peak = Math.max(layer.gain, FLOOR);
    const starts: OscillatorNode[] = [];
    const o = ac.createOscillator();
    o.type = wave(layer.wave);
    o.frequency.setValueAtTime(freq, at);
    if (layer.detune) o.detune.value = layer.detune;
    if (layer.pitchEnv) {
      const p = layer.pitchEnv;
      if (p.curve === 'lin') o.frequency.linearRampToValueAtTime(p.to, at + p.time);
      else o.frequency.exponentialRampToValueAtTime(Math.max(p.to, 1), at + p.time);
    }
    if (layer.type === 'fm' && layer.fm) {
      const m = ac.createOscillator();
      m.type = wave(layer.fm.modWave);
      const mf = freq * layer.fm.ratio;
      m.frequency.setValueAtTime(mf, at);
      const mg = ac.createGain();
      mg.gain.value = layer.fm.index * mf;
      m.connect(mg);
      mg.connect(o.frequency);
      starts.push(m);
    }
    starts.push(o);

    let node: AudioNode = o;
    if (layer.filter) {
      const f = ac.createBiquadFilter();
      f.type = layer.filter.type;
      f.frequency.setValueAtTime(layer.filter.freq, at);
      f.Q.value = layer.filter.q ?? 0.7;
      if (layer.filter.env)
        f.frequency.exponentialRampToValueAtTime(
          Math.max(layer.filter.env.to, 1),
          at + layer.filter.env.time,
        );
      node.connect(f);
      node = f;
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(FLOOR, at);
    if (env.attack > 0.002) g.gain.exponentialRampToValueAtTime(peak, at + env.attack);
    else g.gain.setValueAtTime(peak, at + env.attack);
    const sus = Math.max(env.sustain * peak, FLOOR);
    g.gain.exponentialRampToValueAtTime(sus, at + env.attack + env.decay);
    if (env.release > 0 && sus > FLOOR)
      g.gain.exponentialRampToValueAtTime(FLOOR, at + env.attack + env.decay + env.release);
    node.connect(g);
    let tail: AudioNode = g;
    if (layer.pan != null) {
      const p = ac.createStereoPanner();
      p.pan.value = layer.pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(bus);
    const stop = at + env.attack + env.decay + env.release + 0.05;
    for (const x of starts) {
      x.start(at);
      x.stop(stop);
    }
  };

  for (const layer of recipe.layers) {
    const base = layer.freq ?? 440;
    const r = layer.repeat;
    const hits = r ? r.count : 1;
    for (let i = 0; i < hits; i++) {
      let f = base;
      if (r && r.pitchSeq) f = r.pitchSeq[Math.min(i, r.pitchSeq.length - 1)]!;
      else if (r && r.pitchPool) f = r.pitchPool[(Math.random() * r.pitchPool.length) | 0]!;
      else if (r && r.pitchStep != null) f = base * Math.pow(2, (r.pitchStep * i) / 12);
      voice(layer, f, t0 + (layer.startOffset || 0) + i * (r ? r.interval : 0));
    }
  }
}
