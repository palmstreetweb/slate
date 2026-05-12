/**
 * Confirmation dialog provider + hook. Replaces browser `confirm()`
 * with a centered modal in the studio's design language.
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

/** Read the studio theme that's currently persisted, so the dialog renders
 *  in the same mode as the rest of the chrome. */
function readStudioMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const v = window.localStorage.getItem('psw-studio-theme');
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* ignored */
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

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

  // ESC closes; Enter confirms. Trap focus to the dialog.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    confirmBtnRef.current?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onClose(true);
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

  // The portal renders outside the AdminShell's wrapper, so we wrap in our
  // own studio data attributes to pick up the same tokens.
  const mode = readStudioMode();

  return createPortal(
    <div data-psw-forms="" data-theme-name="studio" data-theme={mode}>
      <div
        className="studio-dialog-backdrop"
        role="presentation"
        onClick={() => onClose(false)}
      >
        <div
          className="studio-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="studio-dialog-title"
          aria-describedby={opts.message ? 'studio-dialog-message' : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="studio-dialog-title" className="studio-dialog-title">
            {opts.title}
          </h2>
          {opts.message && (
            <div id="studio-dialog-message" className="studio-dialog-message">
              {opts.message}
            </div>
          )}
          <div className="studio-dialog-actions">
            <button type="button" className="studio-btn" onClick={() => onClose(false)}>
              {opts.cancelLabel ?? 'Cancel'}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              className={`studio-btn ${opts.danger ? 'studio-btn--danger-filled' : 'studio-btn--primary'}`}
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
