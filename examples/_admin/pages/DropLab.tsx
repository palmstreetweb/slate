/**
 * Drop Lab — interactive playground for outline drop animations. examples/ only.
 * Open at http://localhost:5173/lab/drop
 */

'use client';

import { useMemo, useState, type PointerEvent } from 'react';
import { hrefFor } from '../_router.js';
import { DROP_PRESETS, type DropPresetId } from '../dropPresets.js';
import { useDropLabDrag } from '../hooks/useDropLabDrag.js';
import { TYPE_GLYPH } from '../questionTypeMeta.js';

type LabQuestion = {
  id: string;
  type: string;
  title: string;
};

const SEED: LabQuestion[] = [
  { id: 'q1', type: 'picture', title: 'Pick a picture' },
  { id: 'q2', type: 'short_text', title: 'What is your name?' },
  { id: 'q3', type: 'short_text', title: "What's your first name?" },
  { id: 'q4', type: 'email', title: 'What is your email?' },
  { id: 'q5', type: 'phone', title: 'Phone number' },
  { id: 'q6', type: 'long_text', title: 'Tell us about your project' },
  { id: 'q7', type: 'multiple_choice', title: 'How did you hear about us?' },
];

function resolveInsertIndex(from: number, insertBefore: number): number {
  return from < insertBefore ? insertBefore - 1 : insertBefore;
}

export function DropLab() {
  const [presetId, setPresetId] = useState<DropPresetId>('current');
  const [questions, setQuestions] = useState<LabQuestion[]>(() => [...SEED]);

  const onMove = (id: string, insertBefore: number) => {
    setQuestions((cur) => {
      const from = cur.findIndex((q) => q.id === id);
      if (from === -1) return cur;
      const to = resolveInsertIndex(from, insertBefore);
      if (to === from) return cur;
      const next = [...cur];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  };

  const {
    listRef,
    wrapRef,
    ghostElRef,
    draggingId,
    dragActive,
    phase,
    lineY,
    lineAnimated,
    showDropLine,
    lineAbsorbing,
    ghost,
    isSettling,
    landedId,
    flashIndex,
    rippleAt,
    didDragRef,
    beginPointerDrag,
    preset,
  } = useDropLabDrag(questions, onMove, presetId);

  const ghostQuestion = draggingId ? questions.find((q) => q.id === draggingId) : undefined;
  const showDragChrome = dragActive || isSettling;

  const presetMeta = useMemo(
    () => DROP_PRESETS.find((p) => p.id === presetId) ?? DROP_PRESETS[0]!,
    [presetId],
  );

  return (
    <div data-slate-forms="" data-theme-name="slate" data-admin-ui="dark" data-theme="dark">
      <div className="slate-drop-lab">
        <header className="slate-drop-lab-header">
          <div>
            <p className="slate-drop-lab-kicker">Examples / Lab</p>
            <h1 className="slate-drop-lab-title">Drop animation lab</h1>
            <p className="slate-drop-lab-sub">
              Pick a preset, then drag a row by the grip or the row itself.
            </p>
          </div>
          <a href={hrefFor('/')} className="slate-btn slate-btn--ghost">
            ← Back to dashboard
          </a>
        </header>

        <div className="slate-drop-lab-grid">
          <aside className="slate-drop-lab-presets" aria-label="Drop presets">
            {DROP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`slate-drop-lab-preset${presetId === p.id ? ' slate-drop-lab-preset--active' : ''}`}
                aria-pressed={presetId === p.id}
                onClick={() => setPresetId(p.id)}
              >
                <span className="slate-drop-lab-preset-label">{p.label}</span>
                <span className="slate-drop-lab-preset-desc">{p.description}</span>
              </button>
            ))}
          </aside>

          <section className="slate-drop-lab-stage" aria-label="Drag playground">
            <div className="slate-drop-lab-stage-head">
              <p className="slate-label" style={{ margin: 0 }}>
                Playground
              </p>
              <span className="slate-drop-lab-active-pill">{presetMeta.label}</span>
            </div>

            <div
              ref={wrapRef}
              className={`slate-outline-list-wrap slate-drop-lab-list-wrap${showDragChrome ? ' slate-outline-list-wrap--dragging' : ''}`}
              data-drop-preset={presetId}
            >
              <ul
                ref={listRef}
                className={`slate-outline-list slate-drop-lab-list${showDragChrome ? ' slate-outline-list--dragging' : ''}`}
              >
                {questions.map((q, i) => {
                  const isLifted = draggingId === q.id && (dragActive || isSettling);
                  const isFlashing = flashIndex === i;
                  const isRippleAbove = rippleAt !== null && i === rippleAt - 1;
                  const isRippleBelow = rippleAt !== null && i === rippleAt;

                  const startDrag = (
                    e: PointerEvent<HTMLButtonElement>,
                    row: HTMLButtonElement,
                  ) => {
                    if (e.button !== 0) return;
                    beginPointerDrag(
                      q.id,
                      i,
                      e.clientX,
                      e.clientY,
                      row.getBoundingClientRect(),
                      e.pointerId,
                      e.currentTarget,
                    );
                  };

                  return (
                    <li
                      key={q.id}
                      className={`slate-outline-item${isLifted ? ' slate-outline-item--lifted' : ''}${landedId === q.id ? ` ${preset.landedClass}` : ''}${isFlashing ? ' slate-drop-slot-flash' : ''}${isRippleAbove ? ' slate-drop-ripple--above' : ''}${isRippleBelow ? ' slate-drop-ripple--below' : ''}`}
                    >
                      <div className="slate-outline-item-inner">
                        <button
                          type="button"
                          className="slate-outline-grip"
                          aria-label={`Reorder ${q.title}`}
                          onPointerDown={(e) => {
                            const row = e.currentTarget.parentElement?.querySelector(
                              '.slate-outline-row',
                            ) as HTMLButtonElement | null;
                            if (!row) return;
                            startDrag(e, row);
                          }}
                        >
                          <GripIcon />
                        </button>
                        <button
                          type="button"
                          className="slate-outline-row"
                          style={{ flex: 1, cursor: 'grab', touchAction: 'none' }}
                          onClick={() => {
                            if (didDragRef.current) {
                              didDragRef.current = false;
                            }
                          }}
                          onPointerDown={(e) => startDrag(e, e.currentTarget)}
                        >
                          <span className="slate-outline-idx">{String(i + 1).padStart(2, '0')}</span>
                          <span className="slate-outline-glyph" aria-hidden>
                            {TYPE_GLYPH[q.type as keyof typeof TYPE_GLYPH] ?? 'T'}
                          </span>
                          <span className="slate-outline-title">{q.title}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {showDropLine && lineY !== null ? (
                <div
                  className={`slate-outline-drop-line${lineAnimated ? ' slate-outline-drop-line--animated' : ''}${isSettling ? ' slate-outline-drop-line--settling' : ''}${lineAbsorbing ? ' slate-drop-line--absorb' : ''}`}
                  style={{ transform: `translateY(${lineY}px)` }}
                  aria-hidden
                />
              ) : null}
            </div>

            <p className="slate-drop-lab-hint">
              Held card scales to 70%. Drop sound plays on successful reorder.
            </p>
          </section>
        </div>
      </div>

      {ghost && ghostQuestion ? (
        <div
          ref={ghostElRef}
          className={`slate-outline-drag-ghost slate-outline-drag-ghost--${phase}`}
          style={
            isSettling
              ? { width: ghost.width }
              : {
                  transform: `translate3d(${ghost.x}px, ${ghost.y}px, 0)`,
                  width: ghost.width,
                }
          }
          aria-hidden
        >
          <div className="slate-outline-card">
            <p className="slate-outline-ghost-label">{ghostQuestion.title}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden>
      <circle cx="2" cy="2" r="1" />
      <circle cx="6" cy="2" r="1" />
      <circle cx="2" cy="6" r="1" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="2" cy="10" r="1" />
      <circle cx="6" cy="10" r="1" />
    </svg>
  );
}
