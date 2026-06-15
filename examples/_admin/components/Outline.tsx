/**
 * Left-rail outline (Typeform's left sidebar). Lists every question with
 * type icon + index + truncated title. Click selects. Welcome / Thanks
 * are pinned and can't be duplicated. Form name and settings (theme,
 * mode, brand) live at the top and bottom of this rail.
 */

import { useState, useRef, useLayoutEffect, useEffect, type PointerEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type {
  FormSound,
  QuestionType,
  Schema,
  ThemeMode,
  ThemeName,
} from '@/index.js';
import { FORM_SOUND_OPTIONS, resolveFormSound } from '@/utils/formSounds.js';
import { ADDABLE_TYPES, TYPE_GLYPH } from '../questionTypeMeta.js';
import { useOutlineDrag } from '../hooks/useOutlineDrag.js';
import { SlateSelect } from './SlateSelect.js';

const THEMES: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'classic', label: 'Classic' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'swiss', label: 'Swiss' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'forest', label: 'Forest' },
  { value: 'mono', label: 'Mono' },
  { value: 'constellation', label: 'Constellation' },
  { value: 'bloom', label: 'Bloom' },
  { value: 'riso', label: 'Riso' },
  { value: 'memphis', label: 'Memphis' },
];

const MODES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'toggle', label: 'Toggle (Let User Pick)' },
  { value: 'auto', label: 'Auto (Follow OS)' },
  { value: 'light', label: 'Force Light' },
  { value: 'dark', label: 'Force Dark' },
];

type Props = {
  schema: Schema;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddQuestion: (type: QuestionType) => void;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  /** Drag-and-drop — move a question to an absolute index. */
  onMove: (id: string, toIndex: number) => void;
  onDuplicate: (id: string) => void;
  onBulkDelete: (ids: string[]) => void | Promise<boolean>;
  // Form-level controls
  name: string;
  onNameChange: (v: string) => void;
  onBrandChange: (v: string) => void;
  onThemeChange: (v: ThemeName) => void;
  onThemeModeChange: (v: ThemeMode) => void;
  onSoundChange: (v: FormSound) => void;
};

export function Outline({
  schema,
  selectedId,
  onSelect,
  onAddQuestion,
  onReorder,
  onMove,
  onDuplicate,
  onBulkDelete,
  name,
  onNameChange,
  onBrandChange,
  onThemeChange,
  onThemeModeChange,
  onSoundChange,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const addAnchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const {
    listRef,
    wrapRef,
    ghostElRef,
    draggingId,
    dragActive,
    lineY,
    lineAnimated,
    showDropLine,
    ghost,
    isSettling,
    settleAnimating,
    didDragRef,
    beginPointerDrag,
  } = useOutlineDrag(schema.questions, onMove);

  const toggleChecked = (id: string) => {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setChecked(new Set());
  };

  const ghostQuestion =
    draggingId !== null ? schema.questions.find((q) => q.id === draggingId) : undefined;
  const ghostIndex =
    ghostQuestion !== undefined ? schema.questions.findIndex((q) => q.id === draggingId) : -1;
  const ghostTitle =
    ghostQuestion && typeof ghostQuestion.title === 'string'
      ? ghostQuestion.title
      : '(dynamic title)';

  const showDragChrome = dragActive || isSettling;

  const portalRoot =
    addAnchorRef.current?.closest('[data-slate-forms][data-theme-name="slate"]') ?? document.body;

  const repositionPopover = () => {
    const anchor = addAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 260);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const maxHeight = Math.min(420, Math.max(160, spaceBelow));
    setPopoverStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      width,
      maxHeight,
      visibility: 'visible',
    });
  };

  useLayoutEffect(() => {
    if (!addOpen) return;
    repositionPopover();
  }, [addOpen]);

  useEffect(() => {
    if (!addOpen) return;

    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addAnchorRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setAddOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddOpen(false);
    };
    const onReposition = () => repositionPopover();

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [addOpen]);

  const addPopover =
    addOpen &&
    createPortal(
      <div
        ref={popoverRef}
        className="slate-popover slate-popover--portal"
        style={popoverStyle}
        role="dialog"
        aria-label="Add question"
      >
        <p className="slate-label" style={{ marginBottom: 6 }}>
          Add to Form
        </p>
        {Array.from(new Set(ADDABLE_TYPES.map((t) => t.group))).map((group) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <p
              style={{
                margin: '6px 0 4px',
                fontSize: 10,
                color: 'var(--slate-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontFamily: 'var(--slate-font-mono)',
              }}
            >
              {group}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {ADDABLE_TYPES.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.type}
                  type="button"
                  className="slate-btn"
                  style={{
                    padding: '6px 8px',
                    fontSize: 12,
                    justifyContent: 'flex-start',
                    minHeight: 30,
                  }}
                  onClick={() => {
                    onAddQuestion(t.type);
                    setAddOpen(false);
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--slate-font-mono)',
                      opacity: 0.6,
                      marginRight: 4,
                    }}
                  >
                    {TYPE_GLYPH[t.type]}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="slate-btn slate-btn--ghost slate-btn--compact"
            onClick={() => setAddOpen(false)}
          >
            Cancel
          </button>
        </div>
      </div>,
      portalRoot,
    );

  return (
    <>
      <aside className="slate-rail slate-rail--left">
        <div className="slate-rail-pad">
          <label className="slate-label" htmlFor="form-name-input">
            Form
          </label>
          <input
            id="form-name-input"
            className="slate-input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Untitled Form"
          />
        </div>

        <Divider />

        <div className="slate-rail-pad" style={{ paddingTop: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <p className="slate-label" style={{ margin: 0 }}>
              Questions
            </p>
            <button
              type="button"
              className="slate-btn slate-btn--ghost slate-btn--compact slate-btn--xs"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
          </div>
          {selectMode && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--slate-dim)' }}>
                {checked.size} selected
              </span>
              <button
                type="button"
                className="slate-btn slate-btn--danger slate-btn--compact slate-btn--xs"
                disabled={checked.size === 0}
                onClick={async () => {
                  const ok = await onBulkDelete([...checked]);
                  if (ok) exitSelectMode();
                }}
              >
                Delete selected
              </button>
            </div>
          )}

          <div
            ref={wrapRef}
            className={`slate-outline-list-wrap${showDragChrome ? ' slate-outline-list-wrap--dragging' : ''}`}
          >
            <ul
              ref={listRef}
              className={`slate-outline-list${showDragChrome ? ' slate-outline-list--dragging' : ''}`}
            >
              {schema.questions.map((q, i) => {
                const isSelected = selectedId === q.id;
                const pinned = q.type === 'welcome' || q.type === 'thanks';
                const titleText = typeof q.title === 'string' ? q.title : '(dynamic title)';
                const canDrag = !pinned && !selectMode;
                const isLifted = draggingId === q.id && (dragActive || isSettling);

                const startReorder = (
                  e: PointerEvent<HTMLButtonElement>,
                  row: HTMLButtonElement,
                ) => {
                  if (!canDrag || e.button !== 0) return;
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
                    className={`slate-outline-item${isLifted ? ' slate-outline-item--lifted' : ''}`}
                  >
                    <div className="slate-outline-item-inner">
                      {selectMode && !pinned && (
                        <input
                          type="checkbox"
                          checked={checked.has(q.id)}
                          onChange={() => toggleChecked(q.id)}
                          aria-label={`Select ${titleText || q.id}`}
                        />
                      )}
                      {canDrag && (
                        <button
                          type="button"
                          className="slate-outline-grip"
                          aria-label={`Reorder ${titleText || q.id}`}
                          onPointerDown={(e) => {
                            const row = e.currentTarget.parentElement?.querySelector(
                              '.slate-outline-row',
                            ) as HTMLButtonElement | null;
                            if (!row) return;
                            startReorder(e, row);
                          }}
                        >
                          <GripIcon />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`slate-outline-row${isSelected && !isLifted ? ' slate-outline-row--selected' : ''}`}
                        style={{
                          flex: 1,
                          cursor: canDrag ? 'grab' : undefined,
                          touchAction: canDrag ? 'none' : undefined,
                        }}
                        onClick={() => {
                          if (didDragRef.current) {
                            didDragRef.current = false;
                            return;
                          }
                          if (selectMode && !pinned) toggleChecked(q.id);
                          else onSelect(q.id);
                        }}
                        onPointerDown={(e) => {
                          if (!canDrag) return;
                          startReorder(e, e.currentTarget);
                        }}
                      >
                        <span className="slate-outline-idx">{String(i + 1).padStart(2, '0')}</span>
                        <span className="slate-outline-glyph" aria-hidden>
                          {TYPE_GLYPH[q.type]}
                        </span>
                        <span className="slate-outline-title">{titleText || '(no title)'}</span>
                        {pinned && (
                          <span className="slate-badge" style={{ fontSize: 9, padding: '0 5px' }}>
                            pinned
                          </span>
                        )}
                      </button>
                    </div>
                    {!pinned && !selectMode && (
                      <div className="slate-outline-actions">
                        {i > 0 && schema.questions[i - 1]?.type !== 'welcome' && (
                          <button
                            type="button"
                            className="slate-icon-btn"
                            onClick={() => onReorder(q.id, 'up')}
                            aria-label="Move up"
                            title="Move up"
                          >
                            ↑
                          </button>
                        )}
                        {i < schema.questions.length - 1 && schema.questions[i + 1]?.type !== 'thanks' && (
                          <button
                            type="button"
                            className="slate-icon-btn"
                            onClick={() => onReorder(q.id, 'down')}
                            aria-label="Move down"
                            title="Move down"
                          >
                            ↓
                          </button>
                        )}
                        <button
                          type="button"
                          className="slate-icon-btn"
                          onClick={() => onDuplicate(q.id)}
                          aria-label="Duplicate"
                          title="Duplicate"
                        >
                          ⧉
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {showDropLine && lineY !== null ? (
              <div
                className={`slate-outline-drop-line${lineAnimated ? ' slate-outline-drop-line--animated' : ''}`}
                style={{ transform: `translateY(${lineY}px)` }}
                aria-hidden
              />
            ) : null}
          </div>

          <div ref={addAnchorRef} style={{ marginTop: 10 }}>
            <button
              type="button"
              className="slate-btn slate-btn--primary"
              onClick={() => setAddOpen(true)}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              + Add
            </button>
          </div>
        </div>

        <Divider />

        <div className="slate-rail-pad">
          <button
            type="button"
            className="slate-rail-toggle"
            onClick={() => setSettingsOpen(!settingsOpen)}
            aria-expanded={settingsOpen}
          >
            <span style={{ fontSize: 11, opacity: 0.6 }}>{settingsOpen ? '▾' : '▸'}</span>
            <span className="slate-label" style={{ margin: 0 }}>
              Settings
            </span>
          </button>

          {settingsOpen && (
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              <label>
                <span className="slate-label">Brand Name (Shown to User)</span>
                <input
                  className="slate-input"
                  value={schema.brand.name}
                  onChange={(e) => onBrandChange(e.target.value)}
                />
              </label>
              <label>
                <span className="slate-label">Theme</span>
                <SlateSelect
                  value={String(schema.theme) as ThemeName}
                  options={THEMES}
                  aria-label="Theme"
                  onChange={onThemeChange}
                />
              </label>
              <label>
                <span className="slate-label">Theme Mode</span>
                <SlateSelect
                  value={schema.themeMode}
                  options={MODES}
                  aria-label="Theme mode"
                  onChange={onThemeModeChange}
                />
              </label>
              <label>
                <span className="slate-label">Step Sound</span>
                <SlateSelect
                  value={resolveFormSound(schema.sound)}
                  options={FORM_SOUND_OPTIONS}
                  aria-label="Step sound"
                  onChange={onSoundChange}
                />
              </label>
            </div>
          )}
        </div>
      </aside>

      {ghost && ghostQuestion && ghostIndex >= 0 ? (
        <div
          ref={ghostElRef}
          className={`slate-outline-drag-ghost${settleAnimating ? ' slate-outline-drag-ghost--settling' : ' slate-outline-drag-ghost--tracking'}`}
          style={{
            transform: `translate3d(${ghost.x}px, ${ghost.y}px, 0)`,
            width: ghost.width,
          }}
          aria-hidden
        >
          <div className="slate-outline-card slate-outline-card--compact">
            <p className="slate-outline-ghost-label">{ghostTitle || '(no title)'}</p>
          </div>
        </div>
      ) : null}
      {addPopover}
    </>
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

function Divider() {
  return (
    <div
      style={{
        height: 1,
        flexShrink: 0,
        background: 'var(--slate-border)',
        margin: '0 12px',
      }}
      aria-hidden
    />
  );
}
