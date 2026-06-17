/**
 * Modal prompt for naming a form before share. Reuses studio dialog chrome.
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
import { isDefaultFormName, normalizeFormNameInput } from './formName.js';
import { readSlateMode } from './slateMode.js';

type PromptFn = () => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

export function PromptFormTitleProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback<PromptFn>(() => {
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((value: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolve?.(value);
  }, []);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {open && <TitleDialog onClose={close} />}
    </PromptContext.Provider>
  );
}

export function usePromptFormTitle(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error('usePromptFormTitle must be called inside <PromptFormTitleProvider>');
  return ctx;
}

function TitleDialog({ onClose }: { onClose: (value: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const trimmed = normalizeFormNameInput(value);
  const canContinue = trimmed.length > 0 && !isDefaultFormName(trimmed);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const mode = readSlateMode();

  return createPortal(
    <div data-slate-forms="" data-theme-name="slate" data-theme={mode}>
      <div
        className="slate-dialog-backdrop"
        role="presentation"
        onClick={() => onClose(null)}
      >
        <div
          className="slate-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slate-title-prompt-heading"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="slate-title-prompt-heading" className="slate-dialog-title">
            Give your form a title
          </h2>
          <p className="slate-dialog-message">
            Add a name before sharing so people know what they&apos;re opening.
          </p>
          <label className="slate-title-prompt-field">
            <span className="slate-label">Form title</span>
            <input
              ref={inputRef}
              className="slate-input"
              value={value}
              placeholder="e.g. Client intake"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canContinue) {
                  e.preventDefault();
                  onClose(trimmed);
                }
              }}
            />
          </label>
          <div className="slate-dialog-actions">
            <button type="button" className="slate-btn" onClick={() => onClose(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="slate-btn slate-btn--primary"
              disabled={!canContinue}
              onClick={() => onClose(trimmed)}
            >
              Continue to share
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
