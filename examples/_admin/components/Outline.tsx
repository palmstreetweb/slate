/**
 * Left-rail outline (Typeform's left sidebar). Lists every question with
 * type icon + index + truncated title. Click selects. Welcome / Thanks
 * are pinned and can't be duplicated. Form name and settings (theme,
 * mode, brand) live at the top and bottom of this rail.
 */

import { useRef, useState } from 'react';
import type {
  FormSound,
  QuestionType,
  Schema,
  ThemeMode,
  ThemeName,
} from '@/index.js';
import { FORM_SOUND_OPTIONS, resolveFormSound } from '@/utils/formSounds.js';
import { ADDABLE_TYPES, TYPE_GLYPH } from '../questionTypeMeta.js';
import { clampOutlineDropIndex } from '../outlineDropIndex.js';
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
  onBulkDelete: (ids: string[]) => void;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const dragId = useRef<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const clearDrag = () => {
    dragId.current = null;
    setDropIndex(null);
  };

  const handleDragOver = (
    e: React.DragEvent,
    index: number,
    pinned: boolean,
    pinnedType: 'welcome' | 'thanks' | null,
  ) => {
    if (dragId.current === null || selectMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (pinned && pinnedType === 'welcome') {
      setDropIndex(clampOutlineDropIndex(schema.questions, 1));
      return;
    }
    if (pinned && pinnedType === 'thanks') {
      setDropIndex(clampOutlineDropIndex(schema.questions, schema.questions.length));
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    setDropIndex(clampOutlineDropIndex(schema.questions, insertBefore));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragId.current !== null && dropIndex !== null) {
      onMove(dragId.current, dropIndex);
    }
    clearDrag();
  };

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

  return (
    <aside className="slate-rail slate-rail--left">
      {/* Form name */}
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

      {/* Questions outline */}
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
            className="slate-btn slate-btn--ghost"
            style={{ fontSize: 10, padding: '2px 8px' }}
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
              className="slate-btn slate-btn--danger"
              style={{ fontSize: 10, padding: '2px 8px' }}
              disabled={checked.size === 0}
              onClick={() => {
                onBulkDelete([...checked]);
                exitSelectMode();
              }}
            >
              Delete selected
            </button>
          </div>
        )}
        <ul
          ref={listRef}
          className="slate-outline-list"
          onDragLeave={(e) => {
            if (!listRef.current?.contains(e.relatedTarget as Node)) {
              setDropIndex(null);
            }
          }}
        >
          {schema.questions.map((q, i) => {
            const isSelected = selectedId === q.id;
            const pinned = q.type === 'welcome' || q.type === 'thanks';
            const pinnedType = q.type === 'welcome' || q.type === 'thanks' ? q.type : null;
            const titleText = typeof q.title === 'string' ? q.title : '(dynamic title)';
            const canDrag = !pinned && !selectMode;
            return (
              <li
                key={q.id}
                className={dropIndex === i ? 'slate-outline-item--drop-before' : undefined}
                onDragOver={(e) => handleDragOver(e, i, pinned, pinnedType)}
                onDrop={handleDrop}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {selectMode && !pinned && (
                    <input
                      type="checkbox"
                      checked={checked.has(q.id)}
                      onChange={() => toggleChecked(q.id)}
                      aria-label={`Select ${titleText || q.id}`}
                    />
                  )}
                  <button
                    type="button"
                    draggable={canDrag}
                    className={`slate-outline-row${isSelected ? ' slate-outline-row--selected' : ''}`}
                    style={{ flex: 1, cursor: canDrag ? 'grab' : undefined }}
                    onClick={() => (selectMode && !pinned ? toggleChecked(q.id) : onSelect(q.id))}
                    onDragStart={(e) => {
                      if (!canDrag) return;
                      dragId.current = q.id;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', q.id);
                    }}
                    onDragEnd={clearDrag}
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

        {/* Add control — questions, screens (welcome/thanks/statement), review */}
        <div style={{ marginTop: 10, position: 'relative' }}>
          {!addOpen ? (
            <button
              type="button"
              className="slate-btn slate-btn--primary"
              onClick={() => setAddOpen(true)}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              + Add
            </button>
          ) : (
            <div className="slate-popover">
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
                        <span style={{ fontFamily: 'var(--slate-font-mono)', opacity: 0.6, marginRight: 4 }}>
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
                  className="slate-btn slate-btn--ghost"
                  onClick={() => setAddOpen(false)}
                  style={{ fontSize: 11, padding: '4px 8px' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Divider />

      {/* Settings (collapsible) */}
      <div className="slate-rail-pad">
        <button
          type="button"
          className="slate-rail-toggle"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
        >
          <span style={{ fontSize: 11, opacity: 0.6 }}>{settingsOpen ? '▾' : '▸'}</span>
          <span className="slate-label" style={{ margin: 0 }}>Settings</span>
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
  );
}

function Divider() {
  return (
    <div
      // The rail is a flex column; without flexShrink:0 a 1px item gets crushed
      // to 0 (and flickers at sub-pixel heights) once the content overflows,
      // e.g. when Settings expands.
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
