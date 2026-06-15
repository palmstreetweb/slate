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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FormSound,
  Question,
  QuestionType,
  Schema,
  ThemeMode,
  ThemeName,
} from '@/index.js';
import { checkSchema, defineSchema } from '@/index.js';
import { playFormSound } from '@/utils/formSounds.js';
import { createForm, getForm, subscribe, updateForm, type FormRecord } from '../_formsStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { AdminShell } from '../shell/AdminShell.js';
import { Outline } from '../components/Outline.js';
import { Canvas } from '../components/Canvas.js';
import { Inspector } from '../components/Inspector.js';
import { SharePanel } from '../components/SharePanel.js';
import { useEditorHistory } from '../useEditorHistory.js';
import { clampOutlineDropIndex, resolveOutlineInsertIndex } from '../outlineDropIndex.js';
import { slugify } from '../shareUrls.js';

type Props = {
  formId: string | null;
};

export function FormEditor({ formId }: Props) {
  const creatingRef = useRef(false);

  // /forms/new → create + redirect.
  useEffect(() => {
    if (formId !== null) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    const created = createForm({
      name: 'Untitled form',
      schema: defineSchema({
        // Brand mirrors form name so the sync below picks up renames.
        brand: { name: 'Untitled form' },
        theme: 'classic',
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
    if (created) navigate(`/forms/${created.id}/edit`);
  }, [formId]);

  if (formId === null) {
    return (
      <AdminShell crumbs={null} fullBleed>
        <div className="slate-empty">Creating…</div>
      </AdminShell>
    );
  }
  return <FormEditorBody formId={formId} />;
}

function FormEditorBody({ formId }: { formId: string }) {
  const initial: FormRecord | null = useMemo(() => getForm(formId), [formId]);
  const [formExists, setFormExists] = useState(() => getForm(formId) !== null);
  const [name, setName] = useState<string>(initial?.name ?? 'Untitled form');
  const [slug, setSlug] = useState<string>(() => {
    if (initial?.slug?.trim()) return slugify(initial.slug);
    if (initial?.name) return slugify(initial.name);
    return '';
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [schema, setSchema] = useState<Schema | null>(initial?.schema ?? null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(() => {
    const first = initial?.schema.questions[0];
    return first?.id ?? '';
  });
  const confirm = useConfirm();

  useEffect(() => {
    const sync = () => setFormExists(getForm(formId) !== null);
    sync();
    return subscribe(sync);
  }, [formId]);

  const getSnapshot = useCallback(
    () => ({
      name,
      schema: schema!,
      selectedId,
    }),
    [name, schema, selectedId],
  );

  const restoreSnapshot = useCallback(
    (snap: { name: string; schema: Schema; selectedId: string }) => {
      setName(snap.name);
      setSchema(snap.schema);
      setSelectedId(snap.selectedId);
    },
    [],
  );

  const { pushHistory } = useEditorHistory({
    getSnapshot,
    restore: restoreSnapshot,
  });

  // SYNCHRONOUS auto-save — every change writes immediately, so clicking
  // Preview right after a setting change never reads stale localStorage.
  useEffect(() => {
    if (!schema) return;
    const [updated, persisted] = updateForm(formId, {
      name,
      slug: slug || undefined,
      schema,
    });
    if (!updated) {
      setSaveError('This form was deleted or could not be found.');
      return;
    }
    if (persisted) {
      setSavedAt(new Date());
      setSaveError(null);
    } else {
      setSaveError('Could not save — localStorage may be full or unavailable.');
    }
  }, [name, slug, schema, formId]);

  // If the selected question was deleted (or doesn't exist after a schema
  // mutation), fall back to the first question.
  useEffect(() => {
    if (!schema) return;
    if (!schema.questions.some((q) => q.id === selectedId)) {
      const first = schema.questions[0];
      if (first) setSelectedId(first.id);
    }
  }, [schema, selectedId]);

  if (!schema || !initial || !formExists) {
    return (
      <AdminShell
        crumbs={
          <span className="slate-crumb">
            <button type="button" className="slate-link" onClick={() => navigate('/')}>
              Forms
            </button>
            {' / Not found'}
          </span>
        }
      >
        <div className="slate-empty">
          <p style={{ margin: '0 0 12px' }}>Form not found.</p>
          <button
            type="button"
            className="slate-btn slate-btn--primary"
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
    pushHistory();
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
    pushHistory();
    if (schema && schema.brand.name === name) {
      setSchema({ ...schema, brand: { ...schema.brand, name: next } });
    }
    setName(next);
    if (slug === slugify(name)) {
      setSlug(slugify(next));
    }
  };

  const updateQuestion = (id: string, patch: Partial<Question>) => {
    pushHistory();
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
    pushHistory();
    setSchema((s) => {
      if (!s) return s;
      return { ...s, questions: s.questions.filter((q) => q.id !== id) };
    });
  };

  const reorder = (id: string, dir: 'up' | 'down') => {
    pushHistory();
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

  /** Drag-and-drop reorder — move a question to an absolute index. */
  const moveTo = (id: string, toIndex: number) => {
    if (!schema) return;
    const arr = [...schema.questions];
    const from = arr.findIndex((q) => q.id === id);
    if (from === -1 || arr[from]!.type === 'welcome' || arr[from]!.type === 'thanks') return;

    const insertBefore = clampOutlineDropIndex(schema.questions, toIndex);
    if (insertBefore === from || insertBefore === from + 1) return;

    pushHistory();
    setSchema((s) => {
      if (!s) return s;
      const next = [...s.questions];
      const fromIdx = next.findIndex((q) => q.id === id);
      if (fromIdx === -1) return s;
      const [moved] = next.splice(fromIdx, 1);
      const insertAt = resolveOutlineInsertIndex(fromIdx, insertBefore);
      next.splice(insertAt, 0, moved!);
      return { ...s, questions: next };
    });
  };

  const duplicateQuestion = (id: string) => {
    pushHistory();
    setSchema((s) => {
      if (!s) return s;
      const idx = s.questions.findIndex((q) => q.id === id);
      const original = s.questions[idx];
      if (!original || original.type === 'welcome' || original.type === 'thanks') return s;
      let copyId = `${original.id}_copy`;
      let n = 2;
      while (s.questions.some((q) => q.id === copyId)) {
        copyId = `${original.id}_copy${n}`;
        n += 1;
      }
      const next = [...s.questions];
      next.splice(idx + 1, 0, cloneQuestion(original, copyId));
      setSelectedId(copyId);
      return { ...s, questions: next };
    });
  };

  const bulkDelete = async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return false;
    const ok = await confirm({
      title: `Delete ${ids.length} ${ids.length === 1 ? 'question' : 'questions'}?`,
      message: 'Removes them from this form. Existing responses keep their data in localStorage.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return false;
    pushHistory();
    setSchema((s) => {
      if (!s) return s;
      return {
        ...s,
        questions: s.questions.filter(
          (q) => q.type === 'welcome' || q.type === 'thanks' || !ids.includes(q.id),
        ),
      };
    });
    return true;
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
    pushHistory();
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

  // Schema sanity (roadmap Phase 6) — recomputed on every change since
  // saving is synchronous; surfaces dangling visibleIf / jump references.
  const issues = checkSchema(schema.questions);

  return (
    <AdminShell
      fullBleed
      crumbs={
        <span className="slate-crumb">
          <button type="button" className="slate-link" onClick={() => navigate('/')}>
            Forms
          </button>
          {' / '}
          <span style={{ color: 'var(--slate-text)' }}>{name}</span>
        </span>
      }
      rightSlot={
        <>
          <span
            style={{
              fontSize: 12,
              color: saveError ? 'var(--slate-error)' : 'var(--slate-dim)',
              marginRight: 8,
              fontFamily: 'var(--slate-font-mono)',
            }}
          >
            {saveError ?? (savedAt ? `Saved ${formatTime(savedAt)}` : 'All changes saved')}
          </span>
          <button
            type="button"
            className="slate-btn"
            onClick={() => navigate(`/forms/${formId}/submissions`)}
          >
            Responses
          </button>
          <button type="button" className="slate-btn" onClick={() => setShareOpen(true)}>
            Share
          </button>
          <button
            type="button"
            className="slate-btn slate-btn--primary"
            onClick={() => navigate(`/forms/${formId}`)}
          >
            Preview ↗
          </button>
        </>
      }
    >
      <SharePanel
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        formId={formId}
        formName={name}
        schema={schema}
      />
      <div className="slate-editor-shell">
        {issues.length > 0 && (
          <div className="slate-editor-alert" role="alert">
            <strong>{issues.length} schema {issues.length === 1 ? 'issue' : 'issues'}:</strong>
            {issues.map((issue, i) => (
              <button
                key={i}
                type="button"
                className="slate-link"
                style={{ fontSize: 13 }}
                onClick={() => setSelectedId(issue.questionId)}
              >
                {issue.message}
              </button>
            ))}
          </div>
        )}

        <div className="slate-editor">
        <Outline
          schema={schema}
          selectedId={selectedQuestion.id}
          onSelect={setSelectedId}
          onAddQuestion={addQuestion}
          onReorder={reorder}
          onMove={moveTo}
          onDuplicate={duplicateQuestion}
          onBulkDelete={bulkDelete}
          name={name}
          onNameChange={handleNameChange}
          onBrandChange={(v) => patchSchema({ brand: { ...schema.brand, name: v } })}
          onThemeChange={(v: ThemeName) => patchSchema({ theme: v })}
          onThemeModeChange={(v: ThemeMode) => patchSchema({ themeMode: v })}
          onSoundChange={(v: FormSound) => {
            patchSchema({ sound: v === 'off' ? undefined : v });
            if (v !== 'off') playFormSound(v);
          }}
        />

        <Canvas schema={schema} selectedQuestion={selectedQuestion} />

        <Inspector
          question={selectedQuestion}
          allQuestions={schema.questions}
          onChange={(patch) => updateQuestion(selectedQuestion.id, patch)}
          onDelete={async () => {
            const titleText =
              'title' in selectedQuestion && typeof selectedQuestion.title === 'string'
                ? selectedQuestion.title
                : selectedQuestion.id;
            const ok = await confirm({
              title: 'Delete this item?',
              message: (
                <>
                  Removes <strong>{titleText}</strong> from this form. Existing responses
                  for it stay in localStorage but won&apos;t be collected anymore.
                </>
              ),
              confirmLabel: 'Delete',
              danger: true,
            });
            if (ok) removeQuestion(selectedQuestion.id);
          }}
          canDelete={canDelete}
        />
      </div>
      </div>
    </AdminShell>
  );
}

/**
 * Clone a question one level deep — copies option/row/column arrays so the
 * duplicate can be edited independently. Function titles (code-authored
 * schemas only; Slate stores JSON) pass through by reference.
 */
function cloneQuestion(q: Question, id: string): Question {
  const cloned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    cloned[k] = Array.isArray(v)
      ? v.map((item) => (typeof item === 'object' && item !== null ? { ...item } : item))
      : v;
  }
  cloned.id = id;
  return cloned as unknown as Question;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
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
    case 'url':
      return { id, type, title: 'Your website?' };
    case 'number':
      return { id, type, title: 'A number?' };
    case 'date':
      return { id, type, title: 'Pick a date', format: 'MM/DD/YYYY' };
    case 'file_upload':
      return { id, type, title: 'Upload a file', maxSizeMb: 32 };
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
    case 'dropdown':
      return {
        id,
        type,
        title: 'Pick from the list',
        options: [
          { label: 'Option A', value: 'a' },
          { label: 'Option B', value: 'b' },
          { label: 'Option C', value: 'c' },
        ],
      };
    case 'picture_choice':
      return {
        id,
        type,
        title: 'Pick a picture',
        options: [
          { label: 'Option A', value: 'a', src: 'https://picsum.photos/seed/a/400/300' },
          { label: 'Option B', value: 'b', src: 'https://picsum.photos/seed/b/400/300' },
        ],
      };
    case 'ranking':
      return {
        id,
        type,
        title: 'Rank these in order of preference',
        options: [
          { label: 'First thing', value: 'one' },
          { label: 'Second thing', value: 'two' },
          { label: 'Third thing', value: 'three' },
        ],
      };
    case 'matrix':
      return {
        id,
        type,
        title: 'Rate each item',
        rows: [
          { label: 'Quality', value: 'quality' },
          { label: 'Speed', value: 'speed' },
        ],
        columns: [
          { label: 'Poor', value: 'poor' },
          { label: 'Okay', value: 'okay' },
          { label: 'Great', value: 'great' },
        ],
      };
    case 'review':
      return { id, type, title: 'Review your answers', subtitle: 'Tap edit to change anything.' };
    case 'yes_no':
      return { id, type, title: 'Yes or no?' };
    case 'legal':
      return {
        id,
        type,
        title: 'Do you accept our terms?',
        body: 'Add your terms or consent copy here.',
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
    case 'nps':
      return {
        id,
        type,
        title: 'How likely are you to recommend us?',
      };
  }
}
