/**
 * Top-level Slate shell. Holds the theme state for the admin chrome
 * (separate from any rendered form's own theme), the header, and the
 * routed page content.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { Header } from './Header.js';
import { SettingsFab } from './SettingsFab.js';
import { AdminThemeProvider } from '../adminThemeContext.js';
import {
  ADMIN_UI_THEME_STORAGE_KEY,
  detectAdminUiTheme,
  type AdminUiTheme,
} from '../adminUiTheme.js';

const STORAGE_KEY = 'slate-theme';

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
  /** Apply `slate-content--full-bleed` to drop max-width + padding (editor uses this). */
  fullBleed?: boolean;
};

export function AdminShell({ crumbs, rightSlot, children, fullBleed }: Props) {
  const [mode, setMode] = useState<ResolvedThemeMode>(() => detectInitial());
  const [uiTheme, setUiTheme] = useState<AdminUiTheme>(() => detectAdminUiTheme());
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignored
    }
  }, [mode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_UI_THEME_STORAGE_KEY, uiTheme);
    } catch {
      // ignored
    }
  }, [uiTheme]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return (
    <AdminThemeProvider value={{ mode, setMode, toggle, uiTheme, setUiTheme }}>
      <div
        ref={wrapperRef}
        data-slate-forms=""
        data-theme-name="slate"
        data-admin-ui={uiTheme}
        data-theme={mode}
      >
        <div className="slate-app">
          <Header crumbs={crumbs} rightSlot={rightSlot} mode={mode} onToggle={toggle} />
          <main className={`slate-content${fullBleed ? ' slate-content--full-bleed' : ''}`}>
            {children}
          </main>
          <SettingsFab />
        </div>
      </div>
    </AdminThemeProvider>
  );
}
