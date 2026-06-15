import type { ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { ThemeToggle } from '@/components/chrome/ThemeToggle.js';
import { SlateLogo } from '../components/SlateLogo.js';
import { navigate, useRoute } from '../_router.js';

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Props = {
  crumbs: ReactNode;
  rightSlot?: ReactNode;
  mode: ResolvedThemeMode;
  onToggle: () => void;
};

export function Header({ crumbs, rightSlot, mode, onToggle }: Props) {
  const route = useRoute();

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
        <button
          type="button"
          className={`slate-btn slate-btn--icon slate-header-settings${route.name === 'settings' ? ' slate-header-settings--active' : ''}`}
          onClick={() => navigate('/settings')}
          aria-label="Settings"
          title="Settings"
        >
          <IconSettings />
        </button>
        {rightSlot}
        <ThemeToggle mode={mode} onToggle={onToggle} />
      </div>
    </header>
  );
}
