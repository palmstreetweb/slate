/**
 * Boot / hydrate loading screen — stack assemble (option 9).
 * Callers gate dismissal with `useMinBootMs` so the splash always gets a beat.
 */

'use client';

import { useEffect, useState } from 'react';
import { SlateLogo } from '../components/SlateLogo.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';
import { playUiSound } from '../uiSounds.js';

/**
 * Minimum branding beat. Real work (auth settle + Neon hydrate) runs in
 * parallel — splash dismisses only when BOTH this timer and stores are ready.
 */
export const LOADING_MIN_MS = 3000;

/** Shared across remounts / routes so we don't stack multiple min-boot waits. */
let bootStartedAt: number | null = null;

/** True once `ms` has elapsed since the first boot splash this page load. */
export function useMinBootMs(ms: number = LOADING_MIN_MS): boolean {
  const [elapsed, setElapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (bootStartedAt == null) bootStartedAt = Date.now();
    return Date.now() - bootStartedAt >= ms;
  });

  useEffect(() => {
    if (bootStartedAt == null) bootStartedAt = Date.now();
    const remaining = Math.max(0, ms - (Date.now() - bootStartedAt));
    if (remaining === 0) {
      setElapsed(true);
      return;
    }
    const id = window.setTimeout(() => setElapsed(true), remaining);
    return () => window.clearTimeout(id);
  }, [ms]);

  return elapsed;
}

type Props = {
  /** Optional status line under the stack. */
  label?: string;
};

export function LoadingScreen({ label = 'Loading' }: Props) {
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  useEffect(() => {
    // Attempt immediately; if AudioContext is locked, first pointer retries via uiSounds.
    playUiSound('loading');
  }, []);

  return (
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-admin-ui={uiTheme}
      data-theme={mode}
      className="slate-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="slate-loading-brand">
        <SlateLogo variant="lockup" height={40} />
      </div>
      <div className="slate-loading-stack" aria-hidden>
        <span className="slate-loading-bar" />
        <span className="slate-loading-bar" />
        <span className="slate-loading-bar slate-loading-bar--accent" />
      </div>
      <span className="slate-loading-label">{label}</span>
    </div>
  );
}
