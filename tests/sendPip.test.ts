import { afterEach, describe, expect, it, vi } from 'vitest';
import { playSendPip, SOUND_1275_SEND_PIP } from '@/utils/sendPip.js';
import * as pixieMallet from '@/utils/pixieMallet.js';

describe('sendPip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the tuned send-pip recipe', () => {
    expect(SOUND_1275_SEND_PIP.duration).toBe(0.13);
    expect(SOUND_1275_SEND_PIP.layers[0]?.freq).toBe(880);
  });

  it('plays through the shared synth engine', () => {
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    playSendPip(0.75);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe(0.75);
    expect(spy.mock.calls[0]?.[1]).toBe(SOUND_1275_SEND_PIP);
  });
});
