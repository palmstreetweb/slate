import type { ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { ThemeToggle } from '@/components/chrome/ThemeToggle.js';
import { SlateLogo } from '../components/SlateLogo.js';
import { navigate } from '../_router.js';
import { SignOutButton } from './SignOutButton.js';
import { StudioInbox } from './StudioInbox.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';

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
        {/* On every studio page — a bad response must never take the page down with it. */}
        <ErrorBoundary label="notifications" fallback={null}>
          <StudioInbox />
        </ErrorBoundary>
        {rightSlot}
        <SignOutButton />
        <ThemeToggle mode={mode} onToggle={onToggle} />
      </div>
    </header>
  );
}
