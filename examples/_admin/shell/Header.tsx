import type { ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { navigate } from '../_router.js';

type Props = {
  crumbs: ReactNode;
  rightSlot?: ReactNode;
  mode: ResolvedThemeMode;
  onToggle: () => void;
};

export function Header({ crumbs, rightSlot, mode, onToggle }: Props) {
  return (
    <header className="slate-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          className="slate-brand"
          onClick={() => navigate('/')}
          aria-label="Slate home"
        >
          <span className="slate-brand-mark">S</span>
          <span>Slate</span>
        </button>
        {crumbs && (
          <>
            <span className="slate-brand-divider" aria-hidden="true" />
            {crumbs}
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {rightSlot}
        <button
          type="button"
          className="slate-btn slate-btn--ghost slate-btn--icon"
          onClick={onToggle}
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
