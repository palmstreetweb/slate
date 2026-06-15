import type { ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { SlateLogo } from '../components/SlateLogo.js';
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          type="button"
          className="slate-brand"
          onClick={() => navigate('/')}
          aria-label="Slate home"
        >
          <SlateLogo variant="lockup" height={26} />
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
          className="slate-theme-toggle"
          onClick={onToggle}
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span className="slate-theme-toggle-dot" aria-hidden="true" />
          <span>{mode === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      </div>
    </header>
  );
}
