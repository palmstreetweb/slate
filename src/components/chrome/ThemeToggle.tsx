/**
 * PSW Theme Toggle button.
 *
 * Markup is verbatim from BUILD_BRIEF.md §8.1 (15px SVGs in 24px viewBoxes,
 * both icons always in DOM, CSS controls visibility).
 *
 * The component is a controlled button — it renders based on the `mode` prop
 * and fires `onToggle`. The actual morph orchestration lives in `useTheme`.
 */

'use client';

import type { Ref } from 'react';
import type { ResolvedThemeMode } from '@/types/Theme.js';

type Props = {
  mode: ResolvedThemeMode;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
};

export function ThemeToggle({ mode, onToggle, ref }: Props) {
  const ariaLabel = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      ref={ref}
      type="button"
      className="theme-toggle"
      aria-label={ariaLabel}
      onClick={onToggle}
    >
      <svg
        className="theme-ico theme-ico--moon"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        className="theme-ico theme-ico--sun"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2.5" />
        <path
          d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
