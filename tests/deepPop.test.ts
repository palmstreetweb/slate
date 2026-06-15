import { afterEach, describe, expect, it, vi } from 'vitest';
import { playDeepPop, SOUND_194_DEEP_POP } from '@/utils/deepPop.js';
import * as pixieMallet from '@/utils/pixieMallet.js';

describe('deepPop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the tuned deep-pop recipe', () => {
    expect(SOUND_194_DEEP_POP.duration).toBe(0.12);
    expect(SOUND_194_DEEP_POP.layers[0]?.freq).toBe(180);
  });

  it('plays through the shared synth engine', () => {
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    playDeepPop(0.65);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe(0.65);
    expect(spy.mock.calls[0]?.[1]).toBe(SOUND_194_DEEP_POP);
  });
});
