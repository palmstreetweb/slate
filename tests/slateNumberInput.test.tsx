/**
 * Studio number fields (QA 2026-10: MEDIA-03, S4, F6, F11). What the owner types
 * is kept while the field has focus — never clamped or re-filled under the caret —
 * and is rounded or pulled into range only when they leave the field.
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SlateNumberInput,
  allowedText,
  fitsLimits,
  settleNumber,
} from '../examples/_admin/components/SlateNumberInput.js';

type Extra = Partial<Parameters<typeof SlateNumberInput>[0]>;

/** A field wired like the inspector: the parent stores what onChange gives it. */
function Harness({
  initial,
  spy,
  ...props
}: { initial?: number; spy: (n?: number) => void } & Extra) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <div data-slate-forms="" data-theme-name="slate">
      <SlateNumberInput
        aria-label="Field"
        {...props}
        value={value}
        onChange={(n) => {
          spy(n);
          setValue(n);
        }}
      />
      <button type="button">elsewhere</button>
    </div>
  );
}

function setup(initial: number | undefined, props: Extra = {}) {
  const spy = vi.fn();
  const user = userEvent.setup();
  render(<Harness initial={initial} spy={spy} {...props} />);
  const input = screen.getByRole('spinbutton', { name: 'Field' }) as HTMLInputElement;
  // Leaving settles the draft a frame after the blur (a focus handed straight back isn't leaving).
  const leave = async () => {
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  };
  return { spy, user, input, leave, last: () => spy.mock.calls.at(-1)?.[0] };
}

describe('SlateNumberInput', () => {
  it('Backspace then type replaces the number (Spots 8 → 12, not 812)', async () => {
    const { user, input, leave, last } = setup(8, {
      min: 1,
      max: 1000,
      integer: true,
      allowEmpty: false,
    });
    await user.click(input);
    await user.keyboard('{End}{Backspace}');
    expect(input).toHaveValue(null);
    await user.keyboard('12');
    expect(input).toHaveValue(12);
    expect(last()).toBe(12);
    await leave();
    expect(input).toHaveValue(12);
  });

  it('select-all then type keeps a first digit below the minimum (voice 60 → 30, not 5 or 50)', async () => {
    const { user, input, leave, spy, last } = setup(60, {
      min: 5,
      max: 300,
      step: 15,
      integer: true,
      allowEmpty: false,
    });
    await user.tripleClick(input);
    await user.keyboard('3');
    // "3" is below 5: it stays on screen, isn't saved, and the range shows under the field.
    expect(input).toHaveValue(3);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('A whole number from 5 to 300');
    await user.keyboard('0');
    expect(last()).toBe(30);
    expect(screen.queryByRole('status')).toBeNull();
    await leave();
    expect(input).toHaveValue(30);
  });

  it('an emptied field that must have a number gets its last number back when left', async () => {
    const { user, input, leave, spy } = setup(10, { min: 0, integer: true, allowEmpty: false });
    await user.tripleClick(input);
    await user.keyboard('{Backspace}');
    expect(input).toHaveValue(null);
    expect(spy).not.toHaveBeenCalled();
    await leave();
    expect(input).toHaveValue(10);
    expect(spy).not.toHaveBeenCalled();
  });

  it('an emptied optional field saves "nothing" (Max Files placeholder shows the default)', async () => {
    const { user, input, leave, last } = setup(10, {
      min: 1,
      max: 100,
      integer: true,
      placeholder: '10',
    });
    await user.tripleClick(input);
    await user.keyboard('{Backspace}');
    expect(last()).toBeUndefined();
    await user.keyboard('4');
    expect(last()).toBe(4);
    await leave();
    expect(input).toHaveValue(4);
  });

  it('a step of 0.01 is kept: "0" and "0.0" wait, they are not saved as 1 (F11)', async () => {
    const { user, input, leave, spy, last } = setup(undefined, { above: 0, placeholder: '1' });
    await user.click(input);
    await user.keyboard('0');
    await user.keyboard('.');
    await user.keyboard('0');
    expect(spy).not.toHaveBeenCalled();
    await user.keyboard('1');
    expect(last()).toBe(0.01);
    await leave();
    expect(input).toHaveValue(0.01);
  });

  it('a step of 0 is refused on leave: the last good step comes back', async () => {
    const { user, input, leave, spy } = setup(2, { above: 0 });
    await user.tripleClick(input);
    await user.keyboard('0');
    expect(screen.getByRole('status')).toHaveTextContent('More than 0');
    await leave();
    expect(input).toHaveValue(2);
    expect(spy).not.toHaveBeenCalled();
  });

  it('whole-number fields round a decimal when left (Min selections 1.5 → 2)', async () => {
    const { user, input, leave, spy, last } = setup(undefined, { min: 0, integer: true });
    await user.click(input);
    await user.keyboard('1.5');
    expect(spy).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('status')).toHaveTextContent('A whole number, 0 or more');
    await leave();
    expect(last()).toBe(2);
    expect(input).toHaveValue(2);
  });

  it('too big a number waits, then is pulled into range on leave (Max Files 25 → 20)', async () => {
    const { user, input, leave, last } = setup(10, { min: 1, max: 20, integer: true });
    await user.tripleClick(input);
    await user.keyboard('25');
    expect(last()).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent('A whole number from 1 to 20');
    await leave();
    expect(last()).toBe(20);
    expect(input).toHaveValue(20);
  });

  it('Enter settles the number without leaving the field', async () => {
    const { user, input, last } = setup(3, { min: 1, max: 10, integer: true });
    await user.tripleClick(input);
    await user.keyboard('40{Enter}');
    expect(last()).toBe(10);
    expect(input).toHaveValue(10);
    expect(input).toHaveFocus();
  });

  it('− on an empty field with a minimum lands on the minimum, never below (Max Size, MEDIA-05)', async () => {
    const { user, last } = setup(undefined, { min: 1, max: 32 });
    await user.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(last()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(last()).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Increase' }));
    expect(last()).toBe(2);
  });

  it('arrow keys step from what is typed and stay in range', async () => {
    const { user, input, last, spy } = setup(5, { min: 5, max: 300, step: 15, integer: true });
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    // Already at the minimum: nothing to save.
    expect(spy).not.toHaveBeenCalled();
    expect(input).toHaveValue(5);
    await user.keyboard('{ArrowUp}');
    expect(last()).toBe(20);
    await user.tripleClick(input);
    await user.keyboard('100{ArrowUp}');
    expect(last()).toBe(115);
  });

  it('compact fields (prices, points) never show a note', async () => {
    const { user, input } = setup(undefined, { min: 0, compact: true });
    await user.click(input);
    await user.keyboard('-');
    await user.keyboard('5');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('number limits in plain words', () => {
  it('says what fits', () => {
    expect(allowedText({ min: 1, max: 20, integer: true })).toBe('A whole number from 1 to 20');
    expect(allowedText({ min: 0, integer: true })).toBe('A whole number, 0 or more');
    expect(allowedText({ min: 0.5, max: 1000 })).toBe('A number from 0.5 to 1,000');
    expect(allowedText({ above: 0 })).toBe('More than 0');
    expect(allowedText({ max: 32 })).toBe('A number, 32 or less');
  });

  it('fits and settles', () => {
    expect(fitsLimits(3, { min: 5 })).toBe(false);
    expect(fitsLimits(1.5, { integer: true })).toBe(false);
    expect(fitsLimits(0, { above: 0 })).toBe(false);
    expect(settleNumber(1.5, { integer: true, min: 0 })).toBe(2);
    expect(settleNumber(-1, { min: 1 })).toBe(1);
    expect(settleNumber(500, { max: 300 })).toBe(300);
    expect(settleNumber(0, { above: 0 })).toBeNull();
    expect(settleNumber(Number.NaN, {})).toBeNull();
  });
});
