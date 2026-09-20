/**
 * Build with AI — prompt sheet + staggered question reveal (ADR-039).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { requestGeneratedForm, type GeneratedDraft } from '../ai/client.js';
import { readSlateMode } from '../slateMode.js';
import { useFocusTrap } from '../useFocusTrap.js';

const CHIPS = [
  'A wedding RSVP with meal choice and plus-one…',
  'SaaS demo request for a B2B analytics tool',
  'Job application for a senior designer',
  'Saturday workshop registration with dietary needs',
] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onReady: (draft: GeneratedDraft) => void | Promise<void>;
};

export function BuildWithAiModal({ open, onClose, onReady }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);

  useFocusTrap(panelRef, open, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setRevealed([]);
    setDraft(null);
    try {
      const next = await requestGeneratedForm(text);
      const titles = next.schema.questions
        .filter((q) => q.type !== 'welcome' && q.type !== 'thanks')
        .map((q) => (typeof q.title === 'string' ? q.title : q.id));
      setDraft(next);
      for (let i = 0; i < titles.length; i += 1) {
        await new Promise((r) => window.setTimeout(r, 110));
        setRevealed(titles.slice(0, i + 1));
      }
      await new Promise((r) => window.setTimeout(r, 220));
      await onReady(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the form.');
      setBusy(false);
    }
  }, [busy, onReady, prompt]);

  if (!open || typeof document === 'undefined') return null;

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const empty = prompt.trim().length === 0;

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
        onClick={() => {
          if (!busy) onClose();
        }}
      >
        <div
          ref={panelRef}
          className="slate-dialog slate-dialog--ai"
          role="dialog"
          aria-modal="true"
          aria-labelledby="slate-ai-title"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="slate-ai-kicker">Build with AI</p>
          <h2 id="slate-ai-title" className="slate-dialog-title">
            Describe the form.
          </h2>
          <p className="slate-dialog-message">
            A first draft you can edit. 3–8 questions, welcome and thank-you included.
          </p>

          <textarea
            className="slate-ai-textarea"
            rows={5}
            value={prompt}
            disabled={busy}
            placeholder="A wedding RSVP with meal choice and plus-one…"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void generate();
              }
            }}
          />

          <div className="slate-ai-chips">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="slate-ai-chip"
                disabled={busy}
                onClick={() => setPrompt(chip)}
              >
                {chip}
              </button>
            ))}
          </div>

          {busy && (
            <ol className="slate-ai-skel" aria-live="polite" aria-label="Generating questions">
              {(revealed.length > 0
                ? revealed
                : ['', '', '', '']
              ).map((title, i) => (
                <li
                  key={`${title || 'sk'}-${i}`}
                  className={`slate-ai-skel-row${title ? ' is-in' : ''}`}
                >
                  <span className="slate-ai-skel-bar" />
                  <span className="slate-ai-skel-label">{title || ' '}</span>
                </li>
              ))}
            </ol>
          )}

          {error && (
            <div className="slate-ai-error" role="alert">
              <p>{error}</p>
              <button type="button" className="slate-btn slate-btn--compact" onClick={() => void generate()}>
                Retry
              </button>
            </div>
          )}

          <div className="slate-dialog-actions">
            <button type="button" className="slate-btn" onClick={onClose} disabled={busy && !error}>
              Cancel
            </button>
            <button
              type="button"
              className="slate-btn slate-btn--primary"
              disabled={empty || (busy && !error)}
              onClick={() => void generate()}
            >
              {busy && !error ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {draft && busy && !error ? (
            <p className="slate-ai-hint">{draft.name}</p>
          ) : (
            <p className="slate-ai-hint">⌘+Enter to generate</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0c.2 2.8 1.2 5 3.2 7C13.2 9 15.4 10 16 10c-.6 0-2.8 1-4.8 3C9.2 15 8.2 17.2 8 20c-.2-2.8-1.2-5-3.2-7C2.8 11 .6 10 0 10c.6 0 2.8-1 4.8-3C6.8 5 7.8 2.8 8 0Z"
        transform="translate(0 -2) scale(.8) translate(2 3.2)"
      />
    </svg>
  );
}
