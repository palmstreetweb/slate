import { useEffect, useMemo, useState } from 'react';
import type {
  Question,
  QuestionType,
  Schema,
  ThemeMode,
  ThemeName,
} from '@/index.js';
import { defineSchema } from '@/index.js';
import { createForm, getForm, updateForm } from '../_formsStore.js';
import { navigate } from '../_router.js';
import { AdminShell } from '../shell/AdminShell.js';
import { QuestionRow } from '../components/QuestionRow.js';

type Props = {
  formId: string | null;
};

const QUESTION_TYPES: ReadonlyArray<{ type: QuestionType; label: string; group: string }> = [
  { type: 'welcome', label: 'Welcome screen', group: 'Screens' },
  { type: 'statement', label: 'Statement', group: 'Screens' },
  { type: 'thanks', label: 'Thank you screen', group: 'Screens' },
  { type: 'short_text', label: 'Short text', group: 'Inputs' },
  { type: 'long_text', label: 'Long text', group: 'Inputs' },
  { type: 'email', label: 'Email', group: 'Inputs' },
  { type: 'phone', label: 'Phone', group: 'Inputs' },
  { type: 'number', label: 'Number', group: 'Inputs' },
  { type: 'single_choice', label: 'Single choice', group: 'Choices' },
  { type: 'multi_choice', label: 'Multi choice', group: 'Choices' },
  { type: 'scale', label: 'Scale (NPS)', group: 'Choices' },
];

const THEMES: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'editorial', label: 'Editorial — Fraunces serif, warm cream' },
  { value: 'swiss', label: 'Swiss — Inter Black, lowercase, poster' },
];

const MODES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'toggle', label: 'Toggle (let user pick)' },
  { value: 'auto', label: 'Auto (follow OS)' },
  { value: 'light', label: 'Force light' },
  { value: 'dark', label: 'Force dark' },
];

export function FormEditor({ formId }: Props) {
  // Lazy bootstrap — if we're at /forms/new, create on mount and redirect.
  useEffect(() => {
    if (formId === null) {
      const created = createForm({
        name: 'Untitled form',
        schema: defineSchema({
          brand: { name: 'Untitled' },
          theme: 'editorial',
          themeMode: 'toggle',
          questions: [
            { id: 'welcome', type: 'welcome', title: 'Welcome.', cta: 'Start' },
            { id: 'q1', type: 'short_text', title: 'First question?', required: true },
            { id: 'done', type: 'thanks', title: "You're all set.", cta: 'Submit another' },
          ],
        }),
      });
      navigate(`/forms/${created.id}/edit`);
    }
  }, [formId]);

  if (formId === null) {
    return <AdminShell crumbs={null}>Creating…</AdminShell>;
  }

  return <FormEditorBody formId={formId} />;
}

function FormEditorBody({ formId }: { formId: string }) {
  const initial = useMemo(() => getForm(formId), [formId]);
  const [name, setName] = useState<string>(initial?.name ?? 'Untitled form');
  const [schema, setSchema] = useState<Schema | null>(initial?.schema ?? null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-save (debounced) when name or schema changes after initial load.
  useEffect(() => {
    if (!schema) return;
    const handle = window.setTimeout(() => {
      const updated = updateForm(formId, { name, schema });
      if (updated) setSavedAt(new Date());
    }, 350);
    return () => window.clearTimeout(handle);
  }, [name, schema, formId]);

  if (!schema || !initial) {
    return (
      <AdminShell crumbs={<NotFoundCrumbs />}>
        <div className="studio-empty">
          <p style={{ margin: '0 0 12px' }}>Form not found.</p>
          <button type="button" className="studio-btn studio-btn--primary" onClick={() => navigate('/')}>
            Back to dashboard
          </button>
        </div>
      </AdminShell>
    );
  }

  const updateQuestion = (id: string, patch: Partial<Question>) => {
    setSchema((s) => {
      if (!s) return s;
      return {
        ...s,
        questions: s.questions.map((q) => (q.id === id ? ({ ...q, ...patch } as Question) : q)),
      };
    });
  };

  const removeQuestion = (id: string) => {
    setSchema((s) => {
      if (!s) return s;
      return { ...s, questions: s.questions.filter((q) => q.id !== id) };
    });
    setExpandedId(null);
  };

  const reorder = (id: string, dir: 'up' | 'down') => {
    setSchema((s) => {
      if (!s) return s;
      const arr = [...s.questions];
      const idx = arr.findIndex((q) => q.id === id);
      if (idx === -1) return s;
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= arr.length) return s;
      [arr[idx]!, arr[swap]!] = [arr[swap]!, arr[idx]!];
      return { ...s, questions: arr };
    });
  };

  const addQuestion = (type: QuestionType) => {
    setAddOpen(false);
    const baseId = `q_${Date.now().toString(36).slice(-5)}`;
    const newQ = makeDefaultQuestion(type, baseId);
    setSchema((s) => {
      if (!s) return s;
      // Insert before the last `thanks` if present, else append.
      const thanksIdx = s.questions.findIndex((q) => q.type === 'thanks');
      const insertAt = thanksIdx === -1 ? s.questions.length : thanksIdx;
      const next = [...s.questions];
      next.splice(insertAt, 0, newQ);
      return { ...s, questions: next };
    });
    setExpandedId(newQ.id);
  };

  return (
    <AdminShell
      crumbs={
        <>
          <span className="studio-crumb">
            <button type="button" className="studio-link" onClick={() => navigate('/')}>
              Forms
            </button>
            {' / '}
            <span style={{ color: 'var(--psw-text)' }}>{name}</span>
          </span>
        </>
      }
      rightSlot={
        <>
          <span style={{ fontSize: 11, color: 'var(--psw-dim)', marginRight: 8 }}>
            {savedAt ? `Saved ${formatTime(savedAt)}` : 'All changes saved'}
          </span>
          <button type="button" className="studio-btn" onClick={() => navigate(`/forms/${formId}/submissions`)}>
            Responses
          </button>
          <button type="button" className="studio-btn studio-btn--primary" onClick={() => navigate(`/forms/${formId}`)}>
            Preview ↗
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 24, maxWidth: 760, margin: '0 auto' }}>

        {/* ---------- Form metadata ---------- */}
        <section className="studio-card">
          <div className="studio-card-pad">
            <h2 className="studio-section-title">Form details</h2>
            <div style={{ display: 'grid', gap: 14 }}>
              <Field label="Form name (internal)">
                <input
                  className="studio-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. PSW — Contact form"
                />
              </Field>
              <Field label="Brand name (shown to user)">
                <input
                  className="studio-input"
                  value={schema.brand.name}
                  onChange={(e) =>
                    setSchema((s) => (s ? { ...s, brand: { ...s.brand, name: e.target.value } } : s))
                  }
                />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Theme">
                  <select
                    className="studio-select"
                    value={String(schema.theme)}
                    onChange={(e) =>
                      setSchema((s) => (s ? { ...s, theme: e.target.value as ThemeName } : s))
                    }
                  >
                    {THEMES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Theme mode">
                  <select
                    className="studio-select"
                    value={schema.themeMode}
                    onChange={(e) =>
                      setSchema((s) => (s ? { ...s, themeMode: e.target.value as ThemeMode } : s))
                    }
                  >
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Questions ---------- */}
        <section>
          <h2 className="studio-section-title" style={{ marginBottom: 12 }}>
            Questions ({schema.questions.length})
          </h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {schema.questions.map((q, i) => (
              <QuestionRow
                key={q.id}
                question={q}
                index={i}
                total={schema.questions.length}
                expanded={expandedId === q.id}
                onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
                onChange={(patch) => updateQuestion(q.id, patch)}
                onDelete={() => {
                  if (confirm(`Delete question "${q.id}"?`)) removeQuestion(q.id);
                }}
                onMoveUp={i > 0 ? () => reorder(q.id, 'up') : null}
                onMoveDown={i < schema.questions.length - 1 ? () => reorder(q.id, 'down') : null}
              />
            ))}
          </div>

          {/* Add question */}
          <div style={{ marginTop: 12 }}>
            {addOpen ? (
              <div className="studio-card studio-card-pad" style={{ display: 'grid', gap: 10 }}>
                <h3 className="studio-section-title" style={{ margin: 0 }}>Add a question</h3>
                {Array.from(new Set(QUESTION_TYPES.map((t) => t.group))).map((group) => (
                  <div key={group}>
                    <p style={{ margin: '6px 0', fontSize: 11, color: 'var(--psw-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {group}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {QUESTION_TYPES.filter((t) => t.group === group).map((t) => (
                        <button
                          key={t.type}
                          type="button"
                          className="studio-btn"
                          onClick={() => addQuestion(t.type)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="studio-btn studio-btn--ghost" onClick={() => setAddOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => setAddOpen(true)}>
                + Add question
              </button>
            )}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function NotFoundCrumbs() {
  return (
    <span className="studio-crumb">
      <button type="button" className="studio-link" onClick={() => navigate('/')}>
        Forms
      </button>{' / Not found'}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="studio-label">{label}</span>
      {children}
    </label>
  );
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function makeDefaultQuestion(type: QuestionType, id: string): Question {
  switch (type) {
    case 'welcome':
      return { id, type, title: 'Welcome.', cta: 'Start' };
    case 'statement':
      return { id, type, title: 'A note.', body: 'Optional context for the user.', cta: 'Continue' };
    case 'thanks':
      return { id, type, title: "You're all set.", cta: 'Submit another' };
    case 'short_text':
      return { id, type, title: 'Short text question?', placeholder: 'Type your answer...', required: true };
    case 'long_text':
      return { id, type, title: 'Long text question?', placeholder: 'Type your answer...' };
    case 'email':
      return { id, type, title: 'Email?', required: true };
    case 'phone':
      return { id, type, title: 'Phone?', required: true, defaultCountry: 'US' };
    case 'number':
      return { id, type, title: 'A number?' };
    case 'single_choice':
      return {
        id,
        type,
        title: 'Pick one',
        options: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
      };
    case 'multi_choice':
      return {
        id,
        type,
        title: 'Pick any',
        options: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
        ],
      };
    case 'scale':
      return { id, type, title: 'Rate on a scale', min: 0, max: 10, minLabel: 'low', maxLabel: 'high' };
  }
}
