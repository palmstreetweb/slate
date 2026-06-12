/**
 * Left-rail outline (Typeform's left sidebar). Lists every question with
 * type icon + index + truncated title. Click selects. Welcome / Thanks
 * are pinned and can't be duplicated. Form name and settings (theme,
 * mode, brand) live at the top and bottom of this rail.
 */

import { useState } from 'react';
import type {
  Question,
  QuestionType,
  Schema,
  ThemeMode,
  ThemeName,
} from '@/index.js';

const ADDABLE_TYPES: ReadonlyArray<{ type: QuestionType; label: string; group: string }> = [
  { type: 'short_text', label: 'Short text', group: 'Inputs' },
  { type: 'long_text', label: 'Long text', group: 'Inputs' },
  { type: 'email', label: 'Email', group: 'Inputs' },
  { type: 'phone', label: 'Phone', group: 'Inputs' },
  { type: 'url', label: 'Website', group: 'Inputs' },
  { type: 'number', label: 'Number', group: 'Inputs' },
  { type: 'date', label: 'Date', group: 'Inputs' },
  { type: 'file_upload', label: 'File upload', group: 'Inputs' },
  { type: 'single_choice', label: 'Single choice', group: 'Choices' },
  { type: 'multi_choice', label: 'Multi choice', group: 'Choices' },
  { type: 'dropdown', label: 'Dropdown', group: 'Choices' },
  { type: 'picture_choice', label: 'Picture choice', group: 'Choices' },
  { type: 'yes_no', label: 'Yes / No', group: 'Choices' },
  { type: 'scale', label: 'Scale', group: 'Choices' },
  { type: 'nps', label: 'NPS (0–10)', group: 'Choices' },
  { type: 'ranking', label: 'Ranking', group: 'Choices' },
  { type: 'matrix', label: 'Matrix', group: 'Choices' },
  { type: 'statement', label: 'Statement', group: 'Other' },
  { type: 'legal', label: 'Legal / consent', group: 'Other' },
];

const TYPE_GLYPH: Record<Question['type'], string> = {
  welcome: '◐',
  statement: '▤',
  thanks: '◑',
  short_text: 'T',
  long_text: '¶',
  email: '@',
  phone: '☏',
  url: '⌘',
  number: '#',
  date: '▦',
  file_upload: '⇪',
  single_choice: '◉',
  multi_choice: '☑',
  dropdown: '▼',
  picture_choice: '▣',
  ranking: '≡',
  matrix: '⊞',
  yes_no: '⊘',
  legal: '§',
  scale: '◇',
  nps: '◈',
};

const THEMES: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'editorial', label: 'Editorial' },
  { value: 'swiss', label: 'Swiss' },
];

const MODES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'toggle', label: 'Toggle (let user pick)' },
  { value: 'auto', label: 'Auto (follow OS)' },
  { value: 'light', label: 'Force light' },
  { value: 'dark', label: 'Force dark' },
];

type Props = {
  schema: Schema;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddQuestion: (type: QuestionType) => void;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  // Form-level controls
  name: string;
  onNameChange: (v: string) => void;
  onBrandChange: (v: string) => void;
  onThemeChange: (v: ThemeName) => void;
  onThemeModeChange: (v: ThemeMode) => void;
};

export function Outline({
  schema,
  selectedId,
  onSelect,
  onAddQuestion,
  onReorder,
  name,
  onNameChange,
  onBrandChange,
  onThemeChange,
  onThemeModeChange,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <aside className="studio-rail studio-rail--left">
      {/* Form name */}
      <div className="studio-rail-pad">
        <label className="studio-label" htmlFor="form-name-input">
          Form
        </label>
        <input
          id="form-name-input"
          className="studio-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Untitled form"
        />
      </div>

      <Divider />

      {/* Questions outline */}
      <div className="studio-rail-pad" style={{ paddingTop: 8 }}>
        <p className="studio-label" style={{ marginBottom: 8 }}>
          Questions
        </p>
        <ul className="studio-outline-list">
          {schema.questions.map((q, i) => {
            const isSelected = selectedId === q.id;
            const pinned = q.type === 'welcome' || q.type === 'thanks';
            const titleText = typeof q.title === 'string' ? q.title : '(dynamic title)';
            return (
              <li key={q.id}>
                <button
                  type="button"
                  className={`studio-outline-row${isSelected ? ' studio-outline-row--selected' : ''}`}
                  onClick={() => onSelect(q.id)}
                >
                  <span className="studio-outline-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="studio-outline-glyph" aria-hidden>
                    {TYPE_GLYPH[q.type]}
                  </span>
                  <span className="studio-outline-title">{titleText || '(no title)'}</span>
                  {pinned && (
                    <span className="studio-badge" style={{ fontSize: 9, padding: '0 5px' }}>
                      pinned
                    </span>
                  )}
                </button>
                {!pinned && (
                  <div className="studio-outline-actions">
                    {i > 0 && schema.questions[i - 1]?.type !== 'welcome' && (
                      <button
                        type="button"
                        className="studio-icon-btn"
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
                        className="studio-icon-btn"
                        onClick={() => onReorder(q.id, 'down')}
                        aria-label="Move down"
                        title="Move down"
                      >
                        ↓
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Add-question control */}
        <div style={{ marginTop: 10, position: 'relative' }}>
          {!addOpen ? (
            <button
              type="button"
              className="studio-btn studio-btn--primary"
              onClick={() => setAddOpen(true)}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              + Add question
            </button>
          ) : (
            <div className="studio-popover">
              <p className="studio-label" style={{ marginBottom: 6 }}>
                Add a question
              </p>
              {Array.from(new Set(ADDABLE_TYPES.map((t) => t.group))).map((group) => (
                <div key={group} style={{ marginBottom: 8 }}>
                  <p
                    style={{
                      margin: '6px 0 4px',
                      fontSize: 10,
                      color: 'var(--psw-dim)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontFamily: 'var(--psw-font-mono)',
                    }}
                  >
                    {group}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {ADDABLE_TYPES.filter((t) => t.group === group).map((t) => (
                      <button
                        key={t.type}
                        type="button"
                        className="studio-btn"
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
                        <span style={{ fontFamily: 'var(--psw-font-mono)', opacity: 0.6, marginRight: 4 }}>
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
                  className="studio-btn studio-btn--ghost"
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
      <div className="studio-rail-pad">
        <button
          type="button"
          className="studio-rail-toggle"
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
        >
          <span style={{ fontSize: 11, opacity: 0.6 }}>{settingsOpen ? '▾' : '▸'}</span>
          <span className="studio-label" style={{ margin: 0 }}>Settings</span>
        </button>

        {settingsOpen && (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <label>
              <span className="studio-label">Brand name (shown to user)</span>
              <input
                className="studio-input"
                value={schema.brand.name}
                onChange={(e) => onBrandChange(e.target.value)}
              />
            </label>
            <label>
              <span className="studio-label">Theme</span>
              <select
                className="studio-select"
                value={String(schema.theme)}
                onChange={(e) => onThemeChange(e.target.value as ThemeName)}
              >
                {THEMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="studio-label">Theme mode</span>
              <select
                className="studio-select"
                value={schema.themeMode}
                onChange={(e) => onThemeModeChange(e.target.value as ThemeMode)}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
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
      style={{ height: 1, background: 'var(--psw-border)', margin: '0 12px' }}
      aria-hidden
    />
  );
}
