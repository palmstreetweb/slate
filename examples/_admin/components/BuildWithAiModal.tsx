/**
 * Build with AI — prompt, review, revise, then open the editor (ADR-039).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { requestGeneratedForm, type GeneratedDraft } from '../ai/client.js';
import { readSlateMode } from '../slateMode.js';
import { useFocusTrap } from '../useFocusTrap.js';
import { lockBodyScroll } from '../lockBodyScroll.js';
import { LoadingScreen } from '../shell/LoadingScreen.js';
import { playUiSound } from '../uiSounds.js';

export const REVISE_CHIPS = [
  {
    label: 'Make it shorter',
    instruction: 'Make it shorter. Cut to the few questions that matter. Keep welcome and thanks.',
  },
  {
    label: 'More formal',
    instruction:
      'Rewrite titles, placeholders, and chrome more formally. Keep the same questions and ids unless a title is sloppy.',
  },
  {
    label: 'Add contact fields',
    instruction:
      'Add email and phone if missing. Keep existing question ids. Put contact near the start after name.',
  },
] as const;

const TYPE_LABEL: Record<string, string> = {
  statement: 'Note',
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  url: 'Website',
  number: 'Number',
  date: 'Date',
  file_upload: 'File',
  single_choice: 'Choice',
  multi_choice: 'Multi',
  dropdown: 'Dropdown',
  picture_choice: 'Pictures',
  ranking: 'Ranking',
  matrix: 'Matrix',
  yes_no: 'Yes / no',
  legal: 'Legal',
  scale: 'Scale',
  nps: 'NPS',
  review: 'Review',
};

type Phase = 'compose' | 'generating' | 'review' | 'opening';

type Props = {
  open: boolean;
  onClose: () => void;
  onReady: (draft: GeneratedDraft) => void | Promise<void>;
};

export function BuildWithAiModal({ open, onClose, onReady }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState('');
  const [revise, setRevise] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('compose');
  const [revealed, setRevealed] = useState<string[]>([]);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [file, setFile] = useState<{ name: string; base64?: string; mime?: string } | null>(null);
  const [dropWash, setDropWash] = useState<'off' | 'hover' | 'landed'>('off');
  const [converting, setConverting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sourcePromptRef = useRef<string>('');
  const dropLandedTimer = useRef<number>(0);

  const busy = phase === 'generating' || phase === 'opening';

  useFocusTrap(panelRef, open, () => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError(null);
    setRevealed([]);
    setDraft(null);
    setRevise('');
    setPhase('compose');
    setFile(null);
    setConverting(false);
    setDropWash('off');
    window.clearTimeout(dropLandedTimer.current);
  }, [open]);

  const lastInstructionRef = useRef<string | undefined>(undefined);
  const genRef = useRef(0);

  const generate = useCallback(
    async (instruction?: string) => {
      const note = instruction?.trim();
      const revising = Boolean(note && draft);
      const text = (revising ? sourcePromptRef.current : prompt).trim();
      if (!text && !file) return;
      lastInstructionRef.current = revising ? note : undefined;
      const token = (genRef.current += 1);
      setPhase('generating');
      setError(null);
      setRevealed([]);
      const fromPdf = !revising && Boolean(file);
      if (fromPdf) setConverting(true);
      const started = Date.now();
      try {
        const next = await requestGeneratedForm({
          prompt: text,
          previous: revising ? draft?.form : undefined,
          instruction: revising ? note : undefined,
          document: fromPdf && file
            ? { filename: file.name, mime: file.mime, base64: file.base64 }
            : undefined,
        });
        if (fromPdf) {
          const remaining = 3000 - (Date.now() - started);
          if (remaining > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, remaining));
          }
        }
        if (token !== genRef.current) return;
        sourcePromptRef.current = next.sourcePrompt;
        const titles = next.schema.questions
          .filter((q) => q.type !== 'welcome' && q.type !== 'thanks')
          .map((q) => (typeof q.title === 'string' ? q.title : q.id));
        setDraft(next);
        for (let i = 0; i < titles.length; i += 1) {
          if (token !== genRef.current) return;
          await new Promise((r) => window.setTimeout(r, 90));
          setRevealed(titles.slice(0, i + 1));
        }
        await new Promise((r) => window.setTimeout(r, 160));
        if (token !== genRef.current) return;
        setRevise('');
        setPhase('review');
      } catch (err) {
        if (token !== genRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not generate the form.');
        setPhase(draft ? 'review' : 'compose');
      } finally {
        if (!revising && file) setConverting(false);
      }
    },
    [draft, prompt, file],
  );

  const takeFile = useCallback(async (picked: File | undefined) => {
    if (!picked || busy) return;
    const name = picked.name || 'document';
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (picked.size > 3_000_000) {
      setError('Keep the file under 3 MB.');
      return;
    }
    if (ext === 'pdf' || picked.type === 'application/pdf') {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      setFile({ name, mime: 'application/pdf', base64: btoa(binary) });
      setError(null);
      return;
    }
    setError('Start with a PDF. Word and Pages can come later.');
  }, [busy]);

  useEffect(() => {
    if (!open || busy || phase === 'review' || phase === 'opening') {
      setDropWash((w) => (w === 'hover' ? 'off' : w));
      return;
    }
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      if (depth === 1) setDropWash('hover');
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDropWash((w) => (w === 'hover' ? 'off' : w));
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropWash('landed');
      playUiSound('drop');
      window.clearTimeout(dropLandedTimer.current);
      dropLandedTimer.current = window.setTimeout(() => setDropWash('off'), 1100);
      void takeFile(event.dataTransfer?.files?.[0]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [open, busy, phase, takeFile]);

  const openEditor = useCallback(async () => {
    if (!draft || phase === 'opening') return;
    setPhase('opening');
    setError(null);
    try {
      await onReady(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the draft.');
      setPhase('review');
    }
  }, [draft, onReady, phase]);

  if (!open || typeof document === 'undefined') return null;

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();
  const empty = prompt.trim().length === 0 && !file;
  const reviewing = phase === 'review' || phase === 'opening';
  const middle = draft?.form.questions ?? [];

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
            {reviewing ? 'Here’s a draft.' : 'Describe your perfect form'}
          </h2>
          <p className="slate-dialog-message">
            {reviewing
              ? 'Revise it here, then open the editor when it looks right. Closing discards it.'
              : 'Type it in the box. Attach a PDF if you already have one.'}
          </p>

          {!reviewing ? (
            <>
              <div className="slate-ai-compose">
                <textarea
                  className="slate-ai-textarea"
                  rows={5}
                  value={prompt}
                  disabled={busy}
                  placeholder="Type what this form should ask…"
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void generate();
                    }
                  }}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={(e) => {
                    void takeFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <div className="slate-ai-attach-row">
                  {file ? (
                    <span className="slate-ai-attach-pill slate-ai-attach-pill--file">
                      <button
                        type="button"
                        className="slate-ai-attach-name"
                        disabled={busy}
                        data-slate-sound="none"
                        onClick={() => fileRef.current?.click()}
                      >
                        {file.name}
                      </button>
                      <button
                        type="button"
                        className="slate-ai-attach-remove"
                        disabled={busy}
                        aria-label="Remove PDF"
                        data-slate-sound="none"
                        onClick={() => setFile(null)}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="slate-ai-attach-pill"
                      disabled={busy}
                      data-slate-sound="none"
                      onClick={() => fileRef.current?.click()}
                    >
                      Upload or Drop PDF
                    </button>
                  )}
                  <button
                    type="button"
                    className="slate-btn slate-btn--primary"
                    disabled={empty || busy}
                    onClick={() => void generate()}
                  >
                    {phase === 'generating' ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {draft ? (
                <div className="slate-ai-review">
                  <p className="slate-ai-review-name">
                    {draft.name}
                    <span className="slate-ai-review-theme">{draft.schema.theme}</span>
                  </p>
                  <ol className="slate-ai-review-list">
                    {middle.map((q) => (
                      <li key={q.id}>
                        <span className="slate-ai-review-type">
                          {TYPE_LABEL[q.type] ?? q.type}
                        </span>
                        <span className="slate-ai-review-title">{q.title}</span>
                        {q.showIfField && q.showIfEquals ? (
                          <span className="slate-ai-review-if">
                            if {q.showIfField} = {q.showIfEquals}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <textarea
                className="slate-ai-textarea slate-ai-textarea--revise"
                rows={2}
                value={revise}
                disabled={busy}
                placeholder="Tell it what to change…"
                onChange={(e) => setRevise(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (revise.trim()) void generate(revise.trim());
                    else void openEditor();
                  }
                }}
              />
              <div className="slate-ai-chips">
                {REVISE_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    className="slate-ai-chip"
                    disabled={busy}
                    onClick={() => void generate(chip.instruction)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {phase === 'generating' && !converting ? (
            <ol className="slate-ai-skel" aria-live="polite" aria-label="Generating questions">
              {(revealed.length > 0 ? revealed : ['', '', '', '']).map((title, i) => (
                <li
                  key={`${title || 'sk'}-${i}`}
                  className={`slate-ai-skel-row${title ? ' is-in' : ''}`}
                >
                  <span className="slate-ai-skel-bar" />
                  <span className="slate-ai-skel-label">{title || ' '}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {error && (
            <div className="slate-ai-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="slate-btn slate-btn--compact"
                onClick={() => void generate(lastInstructionRef.current)}
              >
                Retry
              </button>
            </div>
          )}

          <div className="slate-dialog-actions">
            {reviewing ? (
              <button
                type="button"
                className="slate-btn"
                onClick={() => {
                  setPhase('compose');
                  setError(null);
                  setDraft(null);
                  setRevealed([]);
                }}
                disabled={busy}
              >
                Try again
              </button>
            ) : (
              <button type="button" className="slate-btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            )}
            {reviewing ? (
              <>
                <button
                  type="button"
                  className="slate-btn"
                  disabled={busy || !revise.trim()}
                  onClick={() => void generate(revise.trim())}
                >
                  Revise
                </button>
                <button
                  type="button"
                  className="slate-btn slate-btn--primary"
                  disabled={busy || !draft}
                  onClick={() => void openEditor()}
                >
                  {phase === 'opening' ? 'Opening…' : 'Open in editor'}
                </button>
              </>
            ) : null}
          </div>
          <p className="slate-ai-hint">
            {phase === 'generating'
              ? (draft?.name ?? 'Writing questions…')
              : reviewing
                ? '⌘+Enter revises, or opens the editor if the box is empty'
                : '⌘+Enter to generate · drop a PDF anywhere'}
          </p>
        </div>
      </div>
      {converting ? <LoadingScreen label="Converting" /> : null}
      {dropWash !== 'off' ? (
        <div
          className={`slate-ai-drop-wash${dropWash === 'landed' ? ' is-landed' : ''}`}
          aria-hidden
        >
          <div className="slate-ai-drop-stack">
            <span className="slate-ai-drop-bar" />
            <span className="slate-ai-drop-bar" />
            <span className="slate-ai-drop-bar" />
          </div>
          <p className="slate-ai-drop-label">Drop to convert</p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export function SparkleIcon() {
  return (
    <span className="slate-ai-sparkle" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path
          fill="currentColor"
          d="M8 0c.2 2.8 1.2 5 3.2 7C13.2 9 15.4 10 16 10c-.6 0-2.8 1-4.8 3C9.2 15 8.2 17.2 8 20c-.2-2.8-1.2-5-3.2-7C2.8 11 .6 10 0 10c.6 0 2.8-1 4.8-3C6.8 5 7.8 2.8 8 0Z"
          transform="translate(0 -2) scale(.8) translate(2 3.2)"
        />
      </svg>
    </span>
  );
}
