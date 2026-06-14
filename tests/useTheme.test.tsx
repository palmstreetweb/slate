/**
 * useTheme — mode resolution, persistence, host inheritance, and toggling.
 * The matchMedia stub in tests/setup.ts always reports `matches: false`, so
 * `prefers-color-scheme: light` is false → fallback resolution is 'dark'.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useTheme } from '@/hooks/useTheme.js';
import type { ThemeMode } from '@/types/Theme.js';

const STORAGE_KEY = 'slate-forms-theme';

function setup(mode: ThemeMode) {
  const wrapper = document.createElement('div');
  document.body.appendChild(wrapper);
  const wrapperRef = createRef<HTMLElement>();
  (wrapperRef as { current: HTMLElement | null }).current = wrapper;
  const view = renderHook(() => useTheme({ mode, wrapperRef }));
  return { ...view, wrapper };
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('useTheme — mode resolution', () => {
  it("forced 'light' resolves light with no toggle", () => {
    const { result } = setup('light');
    expect(result.current.resolved).toBe('light');
    expect(result.current.toggleable).toBe(false);
  });

  it("forced 'dark' resolves dark", () => {
    const { result } = setup('dark');
    expect(result.current.resolved).toBe('dark');
  });

  it("'auto' falls back to dark when prefers-color-scheme is not light", () => {
    const { result } = setup('auto');
    expect(result.current.resolved).toBe('dark');
    expect(result.current.toggleable).toBe(false);
  });

  it("'toggle' reads the stored slate-forms-theme value first", () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    const { result } = setup('toggle');
    expect(result.current.resolved).toBe('light');
    expect(result.current.toggleable).toBe(true);
  });

  it("'toggle' inherits the host <html data-theme> when nothing is stored", () => {
    document.documentElement.dataset.theme = 'light';
    const { result } = setup('toggle');
    expect(result.current.resolved).toBe('light');
  });

  it('stored value wins over host theme', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    document.documentElement.dataset.theme = 'light';
    const { result } = setup('toggle');
    expect(result.current.resolved).toBe('dark');
  });
});

describe('useTheme — wrapper + toggling', () => {
  it('applies data-theme to the wrapper, never to <html>', () => {
    const { wrapper } = setup('light');
    expect(wrapper.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('toggle() flips the mode and persists to localStorage', () => {
    const { result, wrapper } = setup('toggle');
    const before = result.current.resolved;
    act(() => result.current.toggle());
    const after = result.current.resolved;
    expect(after).not.toBe(before);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(after);
    expect(wrapper.dataset.theme).toBe(after);
  });

  it('toggle() is a no-op in forced modes', () => {
    const { result } = setup('light');
    act(() => result.current.toggle());
    expect(result.current.resolved).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
