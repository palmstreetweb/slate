/**
 * Top-level studio shell. Holds the theme state for the admin chrome
 * (separate from any rendered form's own theme), the header, and the
 * routed page content.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { Header } from './Header.js';

const STORAGE_KEY = 'psw-studio-theme';

function detectInitial(): ResolvedThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignored
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

type Props = {
  crumbs: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
};

export function AdminShell({ crumbs, rightSlot, children }: Props) {
  const [mode, setMode] = useState<ResolvedThemeMode>(() => detectInitial());
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignored
    }
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return (
    <div
      ref={wrapperRef}
      data-psw-forms=""
      data-theme-name="studio"
      data-theme={mode}
    >
      <div className="studio-app">
        <Header crumbs={crumbs} rightSlot={rightSlot} mode={mode} onToggle={toggle} />
        <main className="studio-content">{children}</main>
      </div>
    </div>
  );
}
