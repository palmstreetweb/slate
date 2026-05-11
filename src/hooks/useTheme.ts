/**
 * Toggle + mode resolution for the PSW theme system. Ports the vanilla JS
 * pattern from PSW's site (brief §8.3) to React, wrapper-scoped.
 *
 *   - localStorage key:    `psw-forms-theme`  (never `psw-theme`)
 *   - First-mount fallback: stored → host <html data-theme> → prefers-color-scheme → 'dark'
 *   - 'auto' mode:          reactively follows prefers-color-scheme, no toggle UI
 *   - 'toggle' mode:        full morph + view-transition + reduced-motion handling
 *   - 'light' | 'dark':     forced, no toggle UI
 */

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { ResolvedThemeMode, ThemeMode } from '@/types/Theme.js';
import { readHostTheme } from '@/utils/tokens.js';
import { useReducedMotion } from './useReducedMotion.js';

const STORAGE_KEY = 'psw-forms-theme';
const MORPH_DURATION_MS = 620;
const SUPPRESS_DURATION_MS = 550;

type UseThemeOpts = {
  /** Schema-driven mode selector. */
  mode: ThemeMode;
  /** Wrapper element ref — receives `data-theme` + `data-theme-switching`. */
  wrapperRef: RefObject<HTMLElement | null>;
  /** Toggle button ref — receives `is-morphing-to-{next}` during the morph. */
  toggleRef?: RefObject<HTMLButtonElement | null>;
};

type UseThemeReturn = {
  /** The currently-applied light/dark mode. */
  resolved: ResolvedThemeMode;
  /** True iff a user-facing toggle should render. */
  toggleable: boolean;
  /** Flip light <→> dark. No-op when `toggleable` is false. */
  toggle: () => void;
};

type StartViewTransitionFn = (cb: () => void) => unknown;

function readStored(): ResolvedThemeMode | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // localStorage may throw in private mode — fall through to other sources.
  }
  return undefined;
}

function writeStored(mode: ResolvedThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignored — see readStored.
  }
}

function prefersLight(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

function detectInitial(mode: ThemeMode): ResolvedThemeMode {
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'toggle') {
    const stored = readStored();
    if (stored) return stored;
    const host = readHostTheme();
    if (host) return host;
  }
  return prefersLight() ? 'light' : 'dark';
}

export function useTheme({ mode, wrapperRef, toggleRef }: UseThemeOpts): UseThemeReturn {
  const reducedMotion = useReducedMotion();
  const [resolved, setResolved] = useState<ResolvedThemeMode>(() => detectInitial(mode));

  const toggleable = mode === 'toggle';

  // Apply data-theme to the wrapper synchronously to avoid a FOUC.
  useLayoutEffect(() => {
    const wrap = wrapperRef.current;
    if (wrap) wrap.dataset.theme = resolved;
  }, [resolved, wrapperRef]);

  // 'auto' mode follows the OS preference reactively, no UI affordance.
  useEffect(() => {
    if (mode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => setResolved(e.matches ? 'light' : 'dark');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  // 'light'/'dark' (forced) — re-sync if the schema changes the mode later.
  useEffect(() => {
    if (mode === 'light' || mode === 'dark') {
      setResolved(mode);
    }
  }, [mode]);

  const toggle = useCallback(() => {
    if (!toggleable) return;
    const next: ResolvedThemeMode = resolved === 'dark' ? 'light' : 'dark';

    // Reduced motion: skip animations entirely, commit + persist immediately.
    if (reducedMotion) {
      setResolved(next);
      writeStored(next);
      return;
    }

    const wrap = wrapperRef.current;
    const btn = toggleRef?.current;
    const morphClass = next === 'light' ? 'is-morphing-to-light' : 'is-morphing-to-dark';
    btn?.classList.add(morphClass);

    const commit = () => {
      setResolved(next);
      writeStored(next);
    };

    const startViewTransition = (
      document as Document & { startViewTransition?: StartViewTransitionFn }
    ).startViewTransition;

    if (typeof startViewTransition === 'function') {
      startViewTransition.call(document, commit);
    } else {
      // Fallback: suppress transitions globally for the morph window.
      if (wrap) {
        wrap.dataset.themeSwitching = 'true';
        window.setTimeout(() => {
          if (wrap.dataset.themeSwitching) delete wrap.dataset.themeSwitching;
        }, SUPPRESS_DURATION_MS);
      }
      commit();
    }

    if (btn) {
      window.setTimeout(() => {
        btn.classList.remove(morphClass);
      }, MORPH_DURATION_MS);
    }
  }, [resolved, reducedMotion, toggleable, wrapperRef, toggleRef]);

  return { resolved, toggleable, toggle };
}
