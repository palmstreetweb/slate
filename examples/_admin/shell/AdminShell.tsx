/**
 * Top-level Slate shell. Holds the theme state for the admin chrome
 * (separate from any rendered form's own theme), the header, and the
 * routed page content.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';
import { Header } from './Header.js';
import { SettingsFab } from './SettingsFab.js';
import { FeedbackButton } from './FeedbackButton.js';
import { PersistErrorToasts } from './PersistErrorToasts.js';
import { AdminThemeProvider } from '../adminThemeContext.js';
import { navigate, routeKey, useRoute } from '../_router.js';
import { usePhone } from '../responses/hooks.js';
import { isNeonConfigured } from '../neon/env.js';
import { useAuth } from '../neon/AuthProvider.js';
import {
  IconGear,
  IconMessage,
  IconMoon,
  IconSignOut,
  IconSun,
  PhoneActionBar,
  PhoneHeader,
  type PhoneChrome,
  type PhoneMenuItem,
} from '../mobile/PhoneChrome.js';
import { openFeedback } from './FeedbackButton.js';
import { rememberSettingsReturn } from './settingsNav.js';
import { useSignOutFlow } from './useSignOutFlow.js';
import { ErrorBoundary, PageCrashFallback } from '../components/ErrorBoundary.js';
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

/** Navigating to another page clears a page crash. */
function pageKey(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname + window.location.hash;
}

type Props = {
  crumbs: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
  /** Apply `slate-content--full-bleed` to drop max-width + padding (editor uses this). */
  fullBleed?: boolean;
  /** Phone top bar, ⋯ menu and bottom action bar (ADR-062). */
  phone?: PhoneChrome;
};

export function AdminShell({ crumbs, rightSlot, children, fullBleed, phone: phoneChrome }: Props) {
  const isPhone = usePhone();
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
        <div
          className={`slate-app${isPhone ? ' slate-app--phone' : ''}${
            isPhone && phoneChrome?.actions ? ' slate-app--actionbar' : ''
          }`}
        >
          {isPhone ? (
            <PhoneShellHeader chrome={phoneChrome} mode={mode} onToggle={toggle} />
          ) : (
            <Header crumbs={crumbs} rightSlot={rightSlot} mode={mode} onToggle={toggle} />
          )}
          <main className={`slate-content${fullBleed ? ' slate-content--full-bleed' : ''}`}>
            <ErrorBoundary
              label="page"
              resetKey={pageKey()}
              fallback={(reset) => <PageCrashFallback onRetry={reset} />}
            >
              {children}
            </ErrorBoundary>
          </main>
          {isPhone && phoneChrome?.actions ? (
            <PhoneActionBar>{phoneChrome.actions}</PhoneActionBar>
          ) : null}
          {/* Phones reach Settings and Feedback from the ⋯ sheet. */}
          {isPhone ? null : <SettingsFab />}
          <FeedbackButton trigger={!isPhone} />
          <PersistErrorToasts />
        </div>
      </div>
    </AdminThemeProvider>
  );
}

/** The phone top bar plus the studio's own ⋯ items (Settings, theme, feedback, sign out). */
function PhoneShellHeader({
  chrome,
  mode,
  onToggle,
}: {
  chrome: PhoneChrome | undefined;
  mode: ResolvedThemeMode;
  onToggle: () => void;
}) {
  const route = useRoute();
  const { user } = useAuth();
  const cloud = isNeonConfigured();
  const { runSignOut, leaving, overlay } = useSignOutFlow();
  const onSettings = route.name === 'settings';

  const shellItems: PhoneMenuItem[] = [
    ...(onSettings
      ? []
      : [
          {
            id: 'settings',
            label: 'Settings',
            icon: <IconGear />,
            separatorBefore: Boolean(chrome?.menu?.length),
            onSelect: () => {
              rememberSettingsReturn(routeKey(route));
              navigate('/settings');
            },
          },
        ]),
    {
      id: 'theme',
      label: mode === 'dark' ? 'Light mode' : 'Dark mode',
      icon: mode === 'dark' ? <IconSun /> : <IconMoon />,
      separatorBefore: onSettings && Boolean(chrome?.menu?.length),
      onSelect: onToggle,
    },
    { id: 'feedback', label: 'Send feedback', icon: <IconMessage />, onSelect: openFeedback },
    ...(cloud
      ? [
          {
            id: 'sign-out',
            label: leaving ? 'Signing out…' : 'Sign out',
            icon: <IconSignOut />,
            disabled: leaving,
            separatorBefore: true,
            onSelect: () => void runSignOut(),
          },
        ]
      : []),
  ];

  return (
    <>
      {overlay}
      <PhoneHeader chrome={chrome} shellItems={shellItems} mode={mode} account={user?.email} />
    </>
  );
}
