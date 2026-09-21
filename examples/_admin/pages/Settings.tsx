'use client';

import { useEffect } from 'react';
import { AdminShell } from '../shell/AdminShell.js';
import { closeSettings } from '../shell/settingsNav.js';
import { BackupPanel } from '../components/BackupPanel.js';
import { useAdminTheme } from '../adminThemeContext.js';
import { isNeonConfigured } from '../neon/env.js';
import { useAuth } from '../neon/AuthProvider.js';
import { useSignOutFlow } from '../shell/useSignOutFlow.js';
import { ADMIN_UI_THEME_OPTIONS } from '../adminUiTheme.js';

function SettingsContent() {
  const { mode, setMode, uiTheme, setUiTheme } = useAdminTheme();
  const { user } = useAuth();
  const { runSignOut, leaving, overlay } = useSignOutFlow();
  const cloud = isNeonConfigured();

  return (
    <div className="slate-settings" role="dialog" aria-label="Settings">
      {overlay}
      <header className="slate-settings-header">
        <h1 className="slate-page-title">Settings</h1>
        <p className="slate-page-sub">Studio appearance — does not change form themes.</p>
      </header>

      <div className="slate-settings-panel">
        <section className="slate-settings-section">
          <h2 className="slate-settings-heading">Color mode</h2>
          <p className="slate-settings-copy">Light or dark for the Slate studio chrome.</p>
          <div className="slate-tabs" role="tablist" aria-label="Studio theme">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'light'}
              className={`slate-tab${mode === 'light' ? ' slate-tab--active' : ''}`}
              onClick={() => setMode('light')}
            >
              Light Theme
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'dark'}
              className={`slate-tab${mode === 'dark' ? ' slate-tab--active' : ''}`}
              onClick={() => setMode('dark')}
            >
              Dark Theme
            </button>
          </div>
        </section>

        <section className="slate-settings-section">
          <h2 className="slate-settings-heading">UI theme</h2>
          <p className="slate-settings-copy">
            Pick a studio palette. Form previews keep each form&apos;s own theme.
          </p>
          <div className="slate-ui-theme-grid" role="radiogroup" aria-label="Studio UI theme">
            {ADMIN_UI_THEME_OPTIONS.map((option) => {
              const selected = uiTheme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`slate-ui-theme-card${selected ? ' slate-ui-theme-card--active' : ''}`}
                  onClick={() => setUiTheme(option.id)}
                >
                  <span className="slate-ui-theme-swatch" aria-hidden>
                    <i style={{ background: option.swatch[0] }} />
                    <i style={{ background: option.swatch[1] }} />
                    <i style={{ background: option.swatch[2] }} />
                  </span>
                  <span className="slate-ui-theme-label">{option.label}</span>
                  <span className="slate-ui-theme-desc">{option.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        {cloud ? (
          <>
            <section className="slate-settings-section">
              <h2 className="slate-settings-heading">Your library</h2>
              <p className="slate-settings-copy" style={{ marginBottom: 0 }}>
                Forms and responses belong to your account. Public fill links still work for anyone
                you share them with — no login required to answer.
              </p>
            </section>
            <section className="slate-settings-section">
              <h2 className="slate-settings-heading">Account</h2>
              <p className="slate-settings-copy">
                Signed in as {user?.email ?? 'unknown'}. Data syncs to Slate cloud.
              </p>
              <button
                type="button"
                className="slate-btn"
                onClick={() => void runSignOut()}
                disabled={leaving}
              >
                {leaving ? 'Signing out…' : 'Sign out'}
              </button>
            </section>
          </>
        ) : (
          <BackupPanel />
        )}
      </div>
    </div>
  );
}

export function Settings() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el || typeof el.closest !== 'function') return;
      if (el.closest('.slate-settings')) return;
      if (el.closest('.slate-settings-fab')) return;
      if (el.closest('.slate-header')) return;
      closeSettings();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  return (
    <AdminShell crumbs={<span className="slate-crumb">Settings</span>}>
      <SettingsContent />
    </AdminShell>
  );
}
