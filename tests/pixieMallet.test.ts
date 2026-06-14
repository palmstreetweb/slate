import { afterEach, describe, expect, it, vi } from 'vitest';
import { playSound, SOUND_711_PIXIE_MALLET } from '@/utils/pixieMallet.js';

/**
 * "Pixie Mallet" synthesizes its tones via the Web Audio API. In jsdom there
 * is no AudioContext, so playSound must degrade to a silent no-op (never
 * throw). When an AudioContext is present it should build the voice graph.
 */

function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}
function fakeOsc(start: ReturnType<typeof vi.fn>) {
  return {
    type: '',
    frequency: fakeParam(),
    detune: fakeParam(),
    connect: vi.fn(),
    start,
    stop: vi.fn(),
  };
}
function fakeGain() {
  return { gain: fakeParam(), connect: vi.fn() };
}

describe('pixie mallet sound', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps its tuned recipe values', () => {
    // Guards against accidental edits to the (tuned) recipe.
    expect(SOUND_711_PIXIE_MALLET.layers[0]?.repeat?.pitchSeq).toEqual([1318.51, 1760, 2093]);
    expect(SOUND_711_PIXIE_MALLET.layers[0]?.gain).toBe(0.07);
  });

  it('is a no-op (does not throw) when Web Audio is unavailable', () => {
    expect(() => playSound()).not.toThrow();
  });

  it('builds the three-hit voice graph when an AudioContext exists', () => {
    const start = vi.fn();
    const createOscillator = vi.fn(() => fakeOsc(start));
    const createGain = vi.fn(() => fakeGain());
    const resume = vi.fn();

    class FakeAudioContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume = resume;
      createGain = createGain;
      createOscillator = createOscillator;
      createBiquadFilter = vi.fn(() => ({
        type: '',
        frequency: fakeParam(),
        Q: { value: 0 },
        connect: vi.fn(),
      }));
      createStereoPanner = vi.fn(() => ({ pan: { value: 0 }, connect: vi.fn() }));
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    playSound(0.6);

    expect(resume).toHaveBeenCalled();
    // The recipe repeats 3 times → 3 oscillators, each started once.
    expect(createOscillator).toHaveBeenCalledTimes(3);
    expect(start).toHaveBeenCalledTimes(3);
  });
});
