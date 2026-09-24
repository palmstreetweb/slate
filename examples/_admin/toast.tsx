/**
 * Lightweight studio toasts — success / error / info. Portaled; examples/ only.
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { detectAdminUiTheme } from './adminUiTheme.js';
import { readSlateMode } from './slateMode.js';
import { playUiSound } from './uiSounds.js';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastInput = {
  title: string;
  detail?: string;
  tone?: ToastTone;
  /** ms; default 3200 (5200 for errors, 6000 with an action) */
  durationMs?: number;
  sound?: 'success' | 'confirm' | 'danger' | 'copy' | 'tap' | 'none';
  /** One small text button, e.g. Undo. Clicking runs it and dismisses the toast. */
  action?: { label: string; onClick: () => void };
};

type ToastItem = ToastInput & { id: string; tone: ToastTone };

type ToastApi = {
  push: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let idSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = `t_${++idSeq}`;
      const tone = toast.tone ?? 'info';
      const durationMs = toast.durationMs ?? (toast.action ? 6000 : tone === 'error' ? 5200 : 3200);
      setItems((prev) => [...prev.slice(-3), { ...toast, id, tone }]);
      if (toast.sound && toast.sound !== 'none') playUiSound(toast.sound);
      else if (tone === 'success') playUiSound('success');
      else if (tone === 'error') playUiSound('danger');

      const timer = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      timersMap.forEach((t) => window.clearTimeout(t));
      timersMap.clear();
    };
  }, []);

  const api = useMemo(() => ({ push }), [push]);
  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined'
        ? createPortal(
            <div
              data-slate-forms=""
              data-theme-name="slate"
              data-admin-ui={uiTheme}
              data-theme={mode}
            >
              <div className="slate-toast-stack" aria-live="polite" aria-relevant="additions">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`slate-toast slate-toast--${item.tone}`}
                    role={item.tone === 'error' ? 'alert' : 'status'}
                  >
                    <div className="slate-toast-body">
                      <strong className="slate-toast-title">{item.title}</strong>
                      {item.detail ? <p className="slate-toast-detail">{item.detail}</p> : null}
                    </div>
                    {item.action ? (
                      <button
                        type="button"
                        className="rsp-toast-action"
                        data-slate-sound="none"
                        onClick={() => {
                          const run = item.action?.onClick;
                          dismiss(item.id);
                          run?.();
                        }}
                      >
                        {item.action.label}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="slate-toast-dismiss"
                      aria-label="Dismiss"
                      data-slate-sound="none"
                      onClick={() => dismiss(item.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {
        /* no-op outside provider */
      },
    };
  }
  return ctx;
}
