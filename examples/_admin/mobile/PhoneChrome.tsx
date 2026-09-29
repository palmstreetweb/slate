/**
 * Phone chrome for the studio (ADR-062): a compact top bar, a ⋯ menu that
 * opens as a bottom sheet, and a bottom action bar for a page's primary
 * actions. AdminShell renders these instead of the desktop header when
 * `usePhone()` is true; pages describe what goes in them with `PhoneChrome`.
 */

'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ResolvedThemeMode } from '@/index.js';
import { SlateLogo } from '../components/SlateLogo.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { navigate } from '../_router.js';
import { lockBodyScroll } from '../lockBodyScroll.js';
import { useFocusTrap } from '../useFocusTrap.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { StudioInbox } from '../shell/StudioInbox.js';
import { IconChevronLeft, IconMore } from '../responses/icons.js';

export type PhoneMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Short grey text after the label (a count, the current state). */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Hairline above this item. */
  separatorBefore?: boolean;
  onSelect(): void;
};

/** What a page puts in the phone chrome. Everything is optional. */
export type PhoneChrome = {
  /** Replaces the brand with a back chevron. */
  back?: { label: string; onClick(): void };
  /** One line, truncated. Without it the bar shows the Slate lockup. */
  title?: ReactNode;
  /** A small second line under the title (save state, publish state). */
  subtitle?: ReactNode;
  /** Page items, shown first in the ⋯ sheet. */
  menu?: ReadonlyArray<PhoneMenuItem>;
  /** Primary actions, pinned to the bottom of the screen. */
  actions?: ReactNode;
};

type HeaderProps = {
  chrome: PhoneChrome | undefined;
  /** Studio items the shell adds after the page's (Settings, theme, …). */
  shellItems: ReadonlyArray<PhoneMenuItem>;
  mode: ResolvedThemeMode;
  account?: string | null;
};

export function PhoneHeader({ chrome, shellItems, mode, account }: HeaderProps) {
  const back = chrome?.back;
  const items = [...(chrome?.menu ?? []), ...shellItems];
  return (
    <header className="slate-header slate-header--phone">
      {back ? (
        <button
          type="button"
          className="slate-m-iconbtn slate-m-back"
          onClick={back.onClick}
          aria-label={`Back to ${back.label}`}
          title={`Back to ${back.label}`}
        >
          <IconChevronLeft size={20} />
        </button>
      ) : (
        <button
          type="button"
          className="slate-brand slate-m-brand"
          onClick={() => navigate('/')}
          aria-label="Slate home"
        >
          {chrome?.title ? (
            <SlateLogo variant="mark" height={30} />
          ) : (
            <SlateLogo variant="lockup" height={26} />
          )}
        </button>
      )}
      <div className="slate-m-heading">
        {chrome?.title ? <span className="slate-m-title">{chrome.title}</span> : null}
        {chrome?.subtitle ? <span className="slate-m-subtitle">{chrome.subtitle}</span> : null}
      </div>
      <div className="slate-m-header-actions">
        <ErrorBoundary label="notifications" fallback={null}>
          <StudioInbox />
        </ErrorBoundary>
        <PhoneMenu items={items} mode={mode} account={account} />
      </div>
    </header>
  );
}

function PhoneMenu({
  items,
  mode,
  account,
}: {
  items: ReadonlyArray<PhoneMenuItem>;
  mode: ResolvedThemeMode;
  account?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = () => setOpen(false);
  useFocusTrap(sheetRef, open, close);

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={`slate-m-iconbtn${open ? ' slate-m-iconbtn--active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Menu"
        title="Menu"
        data-slate-sound="open"
        onClick={() => setOpen((v) => !v)}
      >
        <IconMore size={20} />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-slate-forms=""
              data-theme-name="slate"
              data-admin-ui={detectAdminUiTheme()}
              data-theme={mode}
            >
              <div className="slate-m-sheet-backdrop" role="presentation" onClick={close}>
                <div
                  ref={sheetRef}
                  className="slate-m-sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={titleId}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="slate-m-sheet-grip" aria-hidden="true" />
                  <h2 id={titleId} className="slate-m-sheet-title">
                    Menu
                    {account ? <span className="slate-m-sheet-account">{account}</span> : null}
                  </h2>
                  <ul className="slate-m-sheet-list">
                    {items.map((item) => (
                      <li key={item.id}>
                        {item.separatorBefore ? (
                          <div className="slate-m-sheet-sep" role="separator" />
                        ) : null}
                        <button
                          type="button"
                          className={`slate-m-sheet-item${item.danger ? ' slate-m-sheet-item--danger' : ''}`}
                          disabled={item.disabled}
                          onClick={() => {
                            close();
                            item.onSelect();
                          }}
                        >
                          <span className="slate-m-sheet-icon" aria-hidden="true">
                            {item.icon}
                          </span>
                          <span className="slate-m-sheet-label">{item.label}</span>
                          {item.hint ? (
                            <span className="slate-m-sheet-hint">{item.hint}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="slate-m-sheet-cancel" onClick={close}>
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Pinned bottom bar. Children are buttons; they share the width. */
export function PhoneActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="slate-m-actionbar" role="toolbar" aria-label="Page actions">
      {children}
    </div>
  );
}

/* ---------- small line icons for the sheet (20px grid, currentColor) ---------- */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconGear() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMessage() {
  return (
    <Svg>
      <path d="M3.5 5A1.5 1.5 0 0 1 5 3.5h10A1.5 1.5 0 0 1 16.5 5v7a1.5 1.5 0 0 1-1.5 1.5H8.5L5 16.5v-3A1.5 1.5 0 0 1 3.5 12Z" />
    </Svg>
  );
}

export function IconMoon() {
  return (
    <Svg>
      <path d="M16 11.5A6.5 6.5 0 0 1 8.5 4a6.5 6.5 0 1 0 7.5 7.5Z" />
    </Svg>
  );
}

export function IconSun() {
  return (
    <Svg>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" />
    </Svg>
  );
}

export function IconSignOut() {
  return (
    <Svg>
      <path d="M8 16.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
    </Svg>
  );
}

export function IconPlay() {
  return (
    <Svg>
      <path d="M6.5 4.5v11l9-5.5Z" />
    </Svg>
  );
}

export function IconChart() {
  return (
    <Svg>
      <path d="M4 16V9M10 16V4M16 16v-5" />
    </Svg>
  );
}

export function IconLink() {
  return (
    <Svg>
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9" />
    </Svg>
  );
}

export function IconPencil() {
  return (
    <Svg>
      <path d="m12.5 4.5 3 3L7 16H4v-3Z" />
    </Svg>
  );
}
