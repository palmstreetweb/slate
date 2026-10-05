/**
 * Phone outline grips (QA pass, 2026-10-04, SCROLL-9): a swipe that starts on
 * a drag grip used to reorder questions instead of scrolling the list. On a
 * phone a finger must now rest on the grip for TOUCH_HOLD_MS before the card
 * lifts; moving first is a scroll. A mouse still drags at once, everywhere.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineSchema } from '@/index.js';
import { Outline } from '../examples/_admin/components/Outline.js';
import { TOUCH_HOLD_MS } from '../examples/_admin/hooks/useOutlineDrag.js';

beforeAll(() => {
  // jsdom has no pointer capture; browsers do.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const schema = defineSchema({
  brand: { name: 'Outline Co' },
  theme: 'classic',
  themeMode: 'light',
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hi', cta: 'Start' },
    { id: 'a', type: 'short_text', title: 'First' },
    { id: 'b', type: 'short_text', title: 'Second' },
    { id: 'c', type: 'short_text', title: 'Third' },
    { id: 'done', type: 'thanks', title: 'Bye' },
  ],
});

function renderOutline(phone: boolean) {
  const onMove = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <Outline
      schema={schema}
      selectedId="a"
      onSelect={onSelect}
      onAddQuestion={vi.fn()}
      onReorder={vi.fn()}
      onMove={onMove}
      onDuplicate={vi.fn()}
      onBulkDelete={vi.fn()}
      name="Outline"
      onNameChange={vi.fn()}
      onBrandChange={vi.fn()}
      onLogoChange={vi.fn()}
      onThemeChange={vi.fn()}
      onThemeModeChange={vi.fn()}
      onSoundChange={vi.fn()}
      phone={phone}
    />,
  );
  const grip = utils.container.querySelectorAll<HTMLButtonElement>('.slate-outline-grip')[1]!;
  const item = grip.closest('.slate-outline-item')!;
  return { ...utils, grip, item, onMove, onSelect };
}

const LIFTED = 'slate-outline-item--lifted';
const touch = { pointerType: 'touch', pointerId: 7, button: 0, clientX: 12, clientY: 200 };

describe('phone outline grip', () => {
  it('lifts the card only after the finger rests on the grip', () => {
    const { grip, item } = renderOutline(true);
    fireEvent.pointerDown(grip, touch);
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_MS - 50);
    });
    expect(item).not.toHaveClass(LIFTED);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(item).toHaveClass(LIFTED);
  });

  it('a finger that moves first is scrolling: nothing lifts', () => {
    const { grip, item } = renderOutline(true);
    fireEvent.pointerDown(grip, touch);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    fireEvent.pointerMove(window, { ...touch, clientY: 170 });
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_MS * 2);
    });
    expect(item).not.toHaveClass(LIFTED);
  });

  it('lifting the finger before the hold ends does nothing', () => {
    const { grip, item, onMove } = renderOutline(true);
    fireEvent.pointerDown(grip, touch);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.pointerUp(window, touch);
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_MS * 2);
    });
    expect(item).not.toHaveClass(LIFTED);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('a card put back where it was leaves the next tap on a row alone', () => {
    // Reduced motion settles at once (jsdom has no Web Animations).
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...realMatchMedia(query),
      matches: /prefers-reduced-motion:\s*reduce/.test(query),
    })) as typeof window.matchMedia;
    try {
      const { grip, container, onMove, onSelect } = renderOutline(true);
      fireEvent.pointerDown(grip, touch);
      act(() => {
        vi.advanceTimersByTime(TOUCH_HOLD_MS + 10);
      });
      fireEvent.pointerUp(window, touch);
      fireEvent.click(grip);
      expect(onMove).not.toHaveBeenCalled();

      const row = container.querySelectorAll<HTMLButtonElement>('.slate-outline-row')[3]!;
      fireEvent.pointerDown(row, touch);
      fireEvent.click(row);
      expect(onSelect).toHaveBeenCalledWith('c');
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('once lifted, the page stops scrolling under the finger', () => {
    const { grip, container } = renderOutline(true);
    const wrap = container.querySelector('.slate-outline-list-wrap')!;
    const before = new Event('touchmove', { bubbles: true, cancelable: true });
    wrap.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    fireEvent.pointerDown(grip, touch);
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_MS + 10);
    });
    const during = new Event('touchmove', { bubbles: true, cancelable: true });
    wrap.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
  });
});

describe('mouse drags are unchanged', () => {
  it('a mouse on the grip drags at once, on a phone layout too', () => {
    const { grip, item } = renderOutline(true);
    fireEvent.pointerDown(grip, { ...touch, pointerType: 'mouse' });
    fireEvent.pointerMove(window, { ...touch, pointerType: 'mouse', clientY: 190 });
    expect(item).toHaveClass(LIFTED);
  });

  it('desktop: a touch on the grip still drags at once (rows drag there too)', () => {
    const { grip, item } = renderOutline(false);
    fireEvent.pointerDown(grip, touch);
    fireEvent.pointerMove(window, { ...touch, clientY: 190 });
    expect(item).toHaveClass(LIFTED);
  });
});

describe('phone grip CSS', () => {
  it('lets a swipe that starts on a grip pan the list', () => {
    const css = readFileSync(resolve(__dirname, '../examples/_admin/mobile/mobile.css'), 'utf8');
    const rule = /\.slate-m-editor-pane \.slate-outline-grip \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toMatch(/touch-action:\s*pan-y/);
  });
});
