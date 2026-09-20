/**
 * Confirmation dialog provider + hook. Replaces browser `confirm()`
 * with a centered modal in the Slate's design language.
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Delete form?',
 *     message: 'This also deletes its submissions.',
 *     confirmLabel: 'Delete',
 *     danger: true,
 *   });
 *   if (ok) ...
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { detectAdminUiTheme } from './adminUiTheme.js';
import { readSlateMode } from './slateMode.js';

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
};

type Resolver = (value: boolean) => void;
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    r?.(value);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts !== null && <Dialog opts={opts} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be called inside <ConfirmProvider>');
  return ctx;
}

/* ---------------- dialog ---------------- */

function Dialog({
  opts,
  onClose,
}: {
  opts: ConfirmOptions;
  onClose: (value: boolean) => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // ESC closes. Confirm button is focused on open — Enter activates it natively.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    confirmBtnRef.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener('keydown', onKey);

    // Lock scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus({ preventScroll: true });
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  // Portal is outside AdminShell — must set theme + admin-ui or chrome
  // tokens never bind and the dialog blends into the page (wrong/missing vars).
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  return createPortal(
    <div
      data-slate-forms=""
      data-theme-name="slate"
      data-admin-ui={uiTheme}
      data-theme={mode}
    >
      <div
        className="slate-dialog-backdrop"
        role="presentation"
        onClick={() => onClose(false)}
      >
        <div
          className="slate-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="slate-dialog-title"
          aria-describedby={opts.message ? 'slate-dialog-message' : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="slate-dialog-title" className="slate-dialog-title">
            {opts.title}
          </h2>
          {opts.message && (
            <div id="slate-dialog-message" className="slate-dialog-message">
              {opts.message}
            </div>
          )}
          <div className="slate-dialog-actions">
            <button type="button" className="slate-btn" onClick={() => onClose(false)}>
              {opts.cancelLabel ?? 'Cancel'}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              className={`slate-btn ${opts.danger ? 'slate-btn--danger-filled' : 'slate-btn--primary'}`}
              onClick={() => onClose(true)}
            >
              {opts.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
