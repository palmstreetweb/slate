/**
 * Form editor — three-pane Typeform-style:
 *
 *   ┌────────────────┬─────────────────────────┬────────────────┐
 *   │ Outline        │ Canvas (live preview)   │ Inspector      │
 *   │  - form name   │  - selected question    │  - title       │
 *   │  - question    │    rendered as the user │  - id          │
 *   │    list        │    will see it          │  - required    │
 *   │  - settings    │                         │  - options...  │
 *   └────────────────┴─────────────────────────┴────────────────┘
 *
 * Single-instance pins: only ONE welcome (first) and ONE thanks (last).
 * The Add Question picker excludes those types; adding them no-ops by
 * design. Auto-save is synchronous so navigating to Preview never reads
 * a stale schema.
 */

import { useEffect, useMemo, useState } from 'react';
import type {
  Question,
  QuestionType,
  Schema,
  ThemeMode,
  ThemeName,
} from '@/index.js';
import { defineSchema } from '@/index.js';
import { createForm, getForm, updateForm, type FormRecord } from '../_formsStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { AdminShell } from '../shell/AdminShell.js';
import { Outline } from '../components/Outline.js';
import { Canvas } from '../components/Canvas.js';
import { Inspector } from '../components/Inspector.js';

type Props = {
  formId: string | null;
};

export function FormEditor({ formId }: Props) {
  // /forms/new → create + redirect.
  useEffect(() => {
    if (formId === null) {
      const created = createForm({
        name: 'Untitled form',
        schema: defineSchema({
          // Brand mirrors form name so the sync below picks up renames.
          brand: { name: 'Untitled form' },
          theme: 'editorial',
          themeMode: 'toggle',
          questions: [
            { id: 'welcome', type: 'welcome', title: 'Welcome.', cta: 'Start' },
            { id: 'q1', type: 'short_text', title: 'First question?', required: true },
            {
              id: 'done',
              type: 'thanks',
              title: "You're all set.",
              cta: 'Submit another',
            },
          ],
        }),
      });
      navigate(`/forms/${created.id}/edit`);
    }
  }, [formId]);

  if (formId === null) {
    return (
      <AdminShell crumbs={null} fullBleed>
        <div className="studio-empty">Creating…</div>
      </AdminShell>
    );
  }
  return <FormEditorBody formId={formId} />;
}

function FormEditorBody({ formId }: { formId: string }) {
  const initial: FormRecord | null = useMemo(() => getForm(formId), [formId]);
  const [name, setName] = useState<string>(initial?.name ?? 'Untitled form');
  const [schema, setSchema] = useState<Schema | null>(initial?.schema ?? null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string>(() => {
    const first = initial?.schema.questions[0];
    return first?.id ?? '';
  });
  const confirm = useConfirm();

  // SYNCHRONOUS auto-save — every change writes immediately, so clicking
  // Preview right after a setting change never reads stale localStorage.
  useEffect(() => {
    if (!schema) return;
    const updated = updateForm(formId, { name, schema });
    if (updated) setSavedAt(new Date());
  }, [name, schema, formId]);

  // If the selected question was deleted (or doesn't exist after a schema
  // mutation), fall back to the first question.
  useEffect(() => {
    if (!schema) return;
    if (!schema.questions.some((q) => q.id === selectedId)) {
      const first = schema.questions[0];
      if (first) setSelectedId(first.id);
    }
  }, [schema, selectedId]);

  if (!schema || !initial) {
    return (
      <AdminShell
        crumbs={
          <span className="studio-crumb">
            <button type="button" className="studio-link" onClick={() => navigate('/')}>
              Forms
            </button>
            {' / Not found'}
          </span>
        }
      >
        <div className="studio-empty">
          <p style={{ margin: '0 0 12px' }}>Form not found.</p>
          <button
            type="button"
            className="studio-btn studio-btn--primary"
            onClick={() => navigate('/')}
          >
            Back to dashboard
          </button>
        </div>
      </AdminShell>
    );
  }

  const selectedQuestion =
    schema.questions.find((q) => q.id === selectedId) ?? schema.questions[0]!;

  const isWelcome = selectedQuestion.type === 'welcome';
  const isThanks = selectedQuestion.type === 'thanks';
  const canDelete = !isWelcome && !isThanks;

  /* ---------- mutations ---------- */

  const patchSchema = (patch: Partial<Schema>) => {
    setSchema((s) => (s ? { ...s, ...patch } : s));
  };

  /**
   * Rename the form. If the brand name was previously matching the form
   * name (i.e., user hasn't customized it independently), sync the brand
   * to the new name too — so renaming "Untitled form" → "My 2nd Form"
   * also updates what the visitor sees at the top-left of the form.
   * Once the user edits brand explicitly via the Settings panel, the two
   * stop syncing.
   */
  const handleNameChange = (next: string) => {
    if (schema && schema.brand.name === name) {
      setSchema({ ...schema, brand: { ...schema.brand, name: next } });
    }
    setName(next);
  };

  const updateQuestion = (id: string, patch: Partial<Question>) => {
    setSchema((s) => {
      if (!s) return s;
      return {
        ...s,
        questions: s.questions.map((q) =>
          q.id === id ? ({ ...q, ...patch } as Question) : q,
        ),
      };
    });
  };

  const removeQuestion = (id: string) => {
    setSchema((s) => {
      if (!s) return s;
      return { ...s, questions: s.questions.filter((q) => q.id !== id) };
    });
  };

  const reorder = (id: string, dir: 'up' | 'down') => {
    setSchema((s) => {
      if (!s) return s;
      const arr = [...s.questions];
      const idx = arr.findIndex((q) => q.id === id);
      if (idx === -1) return s;
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= arr.length) return s;
      // Don't swap into the welcome (idx 0) or thanks (last) pinned slots.
      const swapQ = arr[swap]!;
      if (swapQ.type === 'welcome' || swapQ.type === 'thanks') return s;
      [arr[idx]!, arr[swap]!] = [arr[swap]!, arr[idx]!];
      return { ...s, questions: arr };
    });
  };

  const addQuestion = (type: QuestionType) => {
    // Welcome / thanks are single-instance pins. Adding either should focus
    // the existing one instead of duplicating (the picker hides these types
    // anyway, but this is a defensive safeguard).
    if (type === 'welcome' || type === 'thanks') {
      const existing = schema.questions.find((q) => q.type === type);
      if (existing) setSelectedId(existing.id);
      return;
    }

    const baseId = `q_${Date.now().toString(36).slice(-5)}`;
    const newQ = makeDefaultQuestion(type, baseId);
    setSchema((s) => {
      if (!s) return s;
      // Always insert just before the thanks screen (or at the end).
      const thanksIdx = s.questions.findIndex((q) => q.type === 'thanks');
      const insertAt = thanksIdx === -1 ? s.questions.length : thanksIdx;
      const next = [...s.questions];
      next.splice(insertAt, 0, newQ);
      return { ...s, questions: next };
    });
    setSelectedId(newQ.id);
  };

  /* ---------- render ---------- */

  return (
    <AdminShell
      fullBleed
      crumbs={
        <span className="studio-crumb">
          <button type="button" className="studio-link" onClick={() => navigate('/')}>
            Forms
          </button>
          {' / '}
          <span style={{ color: 'var(--psw-text)' }}>{name}</span>
        </span>
      }
      rightSlot={
        <>
          <span
            style={{
              fontSize: 11,
              color: 'var(--psw-dim)',
              marginRight: 8,
              fontFamily: 'var(--psw-font-mono)',
            }}
          >
            {savedAt ? `Saved ${formatTime(savedAt)}` : 'All changes saved'}
          </span>
          <button
            type="button"
            className="studio-btn"
            onClick={() => navigate(`/forms/${formId}/submissions`)}
          >
            Responses
          </button>
          <button
            type="button"
            className="studio-btn studio-btn--primary"
            onClick={() => navigate(`/forms/${formId}`)}
          >
            Preview ↗
          </button>
        </>
      }
    >
      <div className="studio-editor">
        <Outline
          schema={schema}
          selectedId={selectedQuestion.id}
          onSelect={setSelectedId}
          onAddQuestion={addQuestion}
          onReorder={reorder}
          name={name}
          onNameChange={handleNameChange}
          onBrandChange={(v) => patchSchema({ brand: { ...schema.brand, name: v } })}
          onThemeChange={(v: ThemeName) => patchSchema({ theme: v })}
          onThemeModeChange={(v: ThemeMode) => patchSchema({ themeMode: v })}
        />

        <Canvas schema={schema} selectedQuestion={selectedQuestion} />

        <Inspector
          question={selectedQuestion}
          onChange={(patch) => updateQuestion(selectedQuestion.id, patch)}
          onDelete={async () => {
            const titleText =
              'title' in selectedQuestion && typeof selectedQuestion.title === 'string'
                ? selectedQuestion.title
                : selectedQuestion.id;
            const ok = await confirm({
              title: 'Delete this question?',
              message: (
                <>
                  Removes <strong>{titleText}</strong> from this form. Existing responses
                  for this question stay in localStorage but won&apos;t be collected anymore.
                </>
              ),
              confirmLabel: 'Delete question',
              danger: true,
            });
            if (ok) removeQuestion(selectedQuestion.id);
          }}
          canDelete={canDelete}
        />
      </div>
    </AdminShell>
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
      return {
        id,
        type,
        title: 'A note.',
        body: 'Optional context for the user.',
        cta: 'Continue',
      };
    case 'thanks':
      return { id, type, title: "You're all set.", cta: 'Submit another' };
    case 'short_text':
      return {
        id,
        type,
        title: 'Short text question?',
        placeholder: 'Type your answer...',
        required: true,
      };
    case 'long_text':
      return {
        id,
        type,
        title: 'Long text question?',
        placeholder: 'Type your answer...',
      };
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
      return {
        id,
        type,
        title: 'Rate on a scale',
        min: 0,
        max: 10,
        minLabel: 'low',
        maxLabel: 'high',
      };
  }
}
