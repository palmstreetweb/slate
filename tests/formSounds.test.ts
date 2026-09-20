import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FORM_SOUND_OPTIONS,
  playFormSound,
  playTypewriterTick,
  resolveFormSound,
} from '@/utils/formSounds.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import * as pixieMallet from '@/utils/pixieMallet.js';

describe('formSounds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists off plus ten sound presets', () => {
    expect(FORM_SOUND_OPTIONS).toHaveLength(11);
    expect(FORM_SOUND_OPTIONS[0]?.value).toBe('off');
    expect(FORM_SOUND_OPTIONS.filter((o) => o.value !== 'off')).toHaveLength(10);
  });

  it('normalizes legacy boolean and missing values', () => {
    expect(resolveFormSound(undefined)).toBe('off');
    expect(resolveFormSound(false)).toBe('off');
    expect(resolveFormSound(true)).toBe('pixie-mallet');
    expect(resolveFormSound('marimba')).toBe('marimba');
    expect(resolveFormSound('not-a-sound')).toBe('off');
  });

  it('does not call the synth engine when off', () => {
    const spy = vi.spyOn(pixieMallet, 'playSound');
    playFormSound('off');
    playFormSound(undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  it('plays a preset through the synth engine', () => {
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    playFormSound('glass-tap', 0.5);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe(0.5);
  });

  it('plays a typewriter tick through the synth engine', () => {
    let t = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    playTypewriterTick(0.3);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe(0.3);
  });

  it('rate-limits typewriter ticks', () => {
    let t = 20_000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const spy = vi.spyOn(pixieMallet, 'playSound').mockImplementation(() => {});
    playTypewriterTick();
    playTypewriterTick();
    expect(spy).toHaveBeenCalledOnce();
    t += 30;
    playTypewriterTick();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('isTypewriterKey', () => {
  it('accepts printable characters and deletes', () => {
    expect(isTypewriterKey({ key: 'a', metaKey: false, ctrlKey: false, altKey: false })).toBe(
      true,
    );
    expect(isTypewriterKey({ key: ' ', metaKey: false, ctrlKey: false, altKey: false })).toBe(
      true,
    );
    expect(
      isTypewriterKey({ key: 'Backspace', metaKey: false, ctrlKey: false, altKey: false }),
    ).toBe(true);
    expect(isTypewriterKey({ key: 'Delete', metaKey: false, ctrlKey: false, altKey: false })).toBe(
      true,
    );
  });

  it('rejects Enter, arrows, modifiers, and IME composition', () => {
    expect(isTypewriterKey({ key: 'Enter', metaKey: false, ctrlKey: false, altKey: false })).toBe(
      false,
    );
    expect(
      isTypewriterKey({ key: 'ArrowLeft', metaKey: false, ctrlKey: false, altKey: false }),
    ).toBe(false);
    expect(isTypewriterKey({ key: 'a', metaKey: true, ctrlKey: false, altKey: false })).toBe(
      false,
    );
    expect(
      isTypewriterKey({
        key: 'a',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });
});
