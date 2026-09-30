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
 * The Add picker lists them under Screens — choosing one focuses the pin,
 * or restores it if a form is missing that screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormSound, Question, QuestionType, Schema, ThemeMode, ThemeName } from '@/index.js';
import { checkSchema, defineSchema } from '@/index.js';
import { playFormSound } from '@/utils/formSounds.js';
import {
  createFormAsync,
  getForm,
  permanentlyDeleteForm,
  subscribe,
  updateForm,
  hasUnpublishedChanges,
  publishForm,
} from '../_formsStore.js';
import { clearAiDraft, isAiDraft } from '../ai/client.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { isDefaultFormName } from '../formName.js';
import { usePromptFormTitle } from '../promptFormTitle.js';
import {
  FORM_QUOTA_MAX,
  formQuotaUserMessage,
  isFormQuotaError,
  quotaFromUnknown,
} from '../formQuota.js';
import { AdminShell } from '../shell/AdminShell.js';
import { Outline } from '../components/Outline.js';
import { Canvas } from '../components/Canvas.js';
import { Inspector } from '../components/Inspector.js';
import { EditorLayoutShell, type EditorPhoneTab } from '../components/EditorLayoutShell.js';
import { usePhone } from '../responses/hooks.js';
import { IconChart, IconLink, IconPlay } from '../mobile/PhoneChrome.js';
import { SharePanel } from '../components/SharePanel.js';
import { useEditorHistory } from '../useEditorHistory.js';
import { clampOutlineDropIndex, resolveOutlineInsertIndex } from '../outlineDropIndex.js';
import { uniqueQuestionId } from '../questionIds.js';
import { withOutOfAreaEnding } from '../outOfArea.js';
import { newSlotValue } from '../signupSlots.js';
import { sanitizeSchemaLogic } from '../sanitizeSchema.js';
import { slugify } from '../shareUrls.js';
import { withBrandLogo } from '../brandLogo.js';
import { isNeonConfigured } from '../neon/env.js';
import { useToast } from '../toast.js';
import { playUiSound } from '../uiSounds.js';
import { FlipPill, PublishButton, usePublishIgnition } from '../delight/ignition.js';
import { closedReason } from '../formClose.js';
import { countSubmissions } from '../_submissionStore.js';
import { lockBodyScroll } from '../lockBodyScroll.js';

type Props = {
  formId: string | null;
};

export function FormEditor({ formId }: Props) {
  const creatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // /forms/new → create + redirect (await cloud write so hydrate can't race).
  useEffect(() => {
    if (formId !== null) return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const created = await createFormAsync({
          name: 'Untitled form',
          schema: defineSchema({
            brand: { name: 'Untitled form' },
            theme: 'swiss',
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
        if (cancelled) return;
        if (created) {
          navigate(`/forms/${created.id}/edit`);
          return;
        }
        setCreateError('Could not create the form. Check your connection and try again.');
      } catch (err) {
        if (cancelled) return;
        if (isFormQuotaError(err)) {
          const q = quotaFromUnknown(err);
          setCreateError(
            formQuotaUserMessage({
              used: q?.used ?? FORM_QUOTA_MAX,
              max: q?.max ?? FORM_QUOTA_MAX,
            }),
          );
        } else {
          setCreateError('Could not create the form. Check your connection and try again.');
        }
      }
      creatingRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  if (formId === null) {
    return (
      <AdminShell crumbs={null} fullBleed>
        <div className="slate-empty">
          {createError ? (
            <>
              <p style={{ margin: '0 0 12px' }}>{createError}</p>
              <button
                type="button"
                className="slate-btn slate-btn--primary"
                onClick={() => navigate('/')}
              >
                Back to dashboard
              </button>
            </>
          ) : (
            'Creating…'
          )}
        </div>
      </AdminShell>
    );
  }
  return <FormEditorBody formId={formId} />;
}

function FormEditorBody({ formId }: { formId: string }) {
  const seed = getForm(formId);
  const [formExists, setFormExists] = useState(() => seed !== null);
  const [name, setName] = useState<string>(seed?.name ?? 'Untitled form');
  const [slug, setSlug] = useState<string>(() => {
    if (seed?.slug?.trim()) return slugify(seed.slug);
    if (seed?.name) return slugify(seed.name);
    return '';
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [schema, setSchema] = useState<Schema | null>(() =>
    seed ? sanitizeSchemaLogic(seed.schema) : null,
  );
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(() => {
    const first = seed?.schema.questions[0];
    return first?.id ?? '';
  });
  const confirm = useConfirm();
  const promptFormTitle = usePromptFormTitle();
  const toast = useToast();
  const [aiDraft, setAiDraft] = useState(() => isAiDraft(formId));
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Phones show one pane at a time behind a segmented control (ADR-062).
  const phone = usePhone();
  const [phoneTab, setPhoneTab] = useState<EditorPhoneTab>('outline');
  // Publish ignition (ADR-060): spinner → check → the button bows out.
  const ignite = usePublishIgnition();
  /** The header pill's label, kept on "Draft" until the check lands. */
  const statusLabelRef = useRef<string | null>(null);
  const pinnedLabelRef = useRef<string | null>(null);
  /** Once the editor has a schema, don't re-seed from remote (would clobber edits). */
  const seededRef = useRef(Boolean(seed));
  const cloud = isNeonConfigured();
  const [liveForm, setLiveForm] = useState(() => getForm(formId));

  useEffect(() => {
    const sync = () => {
      const form = getForm(formId);
      if (!form) {
        setFormExists(false);
        return;
      }
      setFormExists(true);
      setLiveForm(form);
      if (seededRef.current) return;
      seededRef.current = true;
      const sanitized = sanitizeSchemaLogic(form.schema);
      setName(form.name);
      setSlug(form.slug?.trim() ? slugify(form.slug) : slugify(form.name));
      setSchema(sanitized);
      setSelectedId(sanitized.questions[0]?.id ?? '');
    };
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

  const { pushHistory, undo, redo } = useEditorHistory({
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

  useEffect(() => {
    const onPersistError = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; message?: string }>).detail;
      if (detail?.kind !== 'form') return;
      // The toast comes from the shell (PersistErrorToasts); this is the inline status.
      setSaveError(detail.message || 'Could not save to the cloud.');
    };
    const onPersistOk = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind !== 'form') return;
      setSaveError(null);
      setSavedAt(new Date());
    };
    window.addEventListener('slate-persist-error', onPersistError);
    window.addEventListener('slate-persist-ok', onPersistOk);
    return () => {
      window.removeEventListener('slate-persist-error', onPersistError);
      window.removeEventListener('slate-persist-ok', onPersistOk);
    };
  }, [toast]);

  const handleShareRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (meta && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (typing) return;
      if (meta && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        navigate(`/forms/${formId}/preview`);
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleShareRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formId]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const unlock = lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShortcutsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [shortcutsOpen]);

  // If the selected question was deleted (or doesn't exist after a schema
  // mutation), fall back to the first question.
  useEffect(() => {
    if (!schema) return;
    if (!schema.questions.some((q) => q.id === selectedId)) {
      const first = schema.questions[0];
      if (first) setSelectedId(first.id);
    }
  }, [schema, selectedId]);

  if (!schema || !formExists) {
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
  // An extra ending (e.g. "out of area", ADR-064) can go; the last one stays.
  const endingCount = schema.questions.filter((q) => q.type === 'thanks').length;
  const canDelete = !isWelcome && (!isThanks || endingCount > 1);

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
    // Slug is fixed at create — a rename must never move the public link (ADR-043).
    setName(next);
  };

  const handleShare = async () => {
    if (isDefaultFormName(name)) {
      const next = await promptFormTitle();
      if (!next) return;
      handleNameChange(next);
    }
    setShareOpen(true);
  };
  handleShareRef.current = handleShare;

  const quickPublish = () => {
    if (!cloud) {
      void handleShare();
      return;
    }
    if (ignite.phase !== 'idle') return;
    const wasStale =
      Boolean(liveForm) &&
      hasUnpublishedChanges({
        ...liveForm!,
        name,
        schema,
      });
    pinnedLabelRef.current = statusLabelRef.current;
    // Publishes now; the check beat brings the toast and flips the pill.
    const ok = ignite.start(
      () => {
        const next = publishForm(formId);
        if (next) setLiveForm(next);
        return Boolean(next);
      },
      {
        onLive: () => {
          pinnedLabelRef.current = null;
          playUiSound('success');
          toast.push({
            title: wasStale ? 'Republished' : 'You’re live',
            detail: 'Public link updated.',
            tone: 'success',
            sound: 'none',
          });
        },
      },
    );
    if (!ok) {
      pinnedLabelRef.current = null;
      toast.push({
        title: 'Could not publish',
        detail: 'Check your connection and try again.',
        tone: 'error',
      });
    }
  };

  const updateQuestion = (id: string, patch: Partial<Question>) => {
    pushHistory();
    setSchema((s) => {
      if (!s) return s;
      return {
        ...s,
        questions: s.questions.map((q) => (q.id === id ? ({ ...q, ...patch } as Question) : q)),
      };
    });
  };

  /**
   * An "out of area" ending for an address with a service area (ADR-064): a
   * Thank You screen shown only outside the area, placed before the other
   * endings, and a jump to it from the address so the rest is skipped.
   */
  const addOutOfAreaEnding = (addressId: string) => {
    const { questions, endingId } = withOutOfAreaEnding(schema.questions, addressId);
    pushHistory();
    setSchema((s) => (s ? { ...s, questions } : s));
    setSelectedId(endingId);
    toast.push({
      title: 'Out-of-area ending added',
      detail: 'Addresses outside your list skip to it.',
      tone: 'success',
    });
  };

  const removeQuestion = (id: string) => {
    pushHistory();
    setSchema((s) => {
      if (!s) return s;
      const q = s.questions.find((item) => item.id === id);
      if (!q || q.type === 'welcome') return s;
      if (q.type === 'thanks' && s.questions.filter((item) => item.type === 'thanks').length < 2) {
        return s;
      }
      return { ...s, questions: s.questions.filter((item) => item.id !== id) };
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
      const title =
        typeof original.title === 'string' ? `${original.title} (copy)` : 'Question (copy)';
      const copyId = uniqueQuestionId(title, new Set(s.questions.map((q) => q.id)));
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
    // Welcome / thanks are single-instance pins. Re-adding focuses the
    // existing screen; if a form is missing one, restore it at the pin.
    if (type === 'welcome' || type === 'thanks') {
      const existing = schema.questions.find((q) => q.type === type);
      if (existing) {
        setSelectedId(existing.id);
        return;
      }
      const preferredId = type === 'welcome' ? 'welcome' : 'done';
      const used = new Set(schema.questions.map((q) => q.id));
      const id = used.has(preferredId) ? uniqueQuestionId(preferredId, used) : preferredId;
      const newQ = makeDefaultQuestion(type, id);
      pushHistory();
      setSchema((s) => {
        if (!s) return s;
        const next = [...s.questions];
        if (type === 'welcome') next.unshift(newQ);
        else next.push(newQ);
        return { ...s, questions: next };
      });
      setSelectedId(newQ.id);
      return;
    }

    const draft = makeDefaultQuestion(type, 'placeholder');
    const title = typeof draft.title === 'string' ? draft.title : type;
    const id = uniqueQuestionId(title, new Set(schema.questions.map((q) => q.id)));
    const newQ = { ...draft, id };
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
  const isPublished = liveForm?.status === 'published';
  const stale =
    Boolean(liveForm) &&
    hasUnpublishedChanges({
      ...liveForm!,
      name,
      schema,
    });
  // Closed (ADR-063) outranks the rest: nobody can fill it in right now.
  const closedNow = isPublished && closedReason(liveForm, countSubmissions(formId)) !== null;
  const liveLabel = closedNow
    ? 'Closed'
    : !cloud
      ? null
      : isPublished
        ? stale
          ? 'Unpublished changes'
          : 'Live'
        : 'Draft';
  statusLabelRef.current = liveLabel;
  // While the spinner runs the pill still reads what it said before the click.
  const statusLabel =
    ignite.phase === 'working' && pinnedLabelRef.current ? pinnedLabelRef.current : liveLabel;
  const pillLive = statusLabel === 'Live';
  const pillStale = statusLabel === 'Unpublished changes';
  const pillClosed = statusLabel === 'Closed';

  const needsPublish = cloud && (!isPublished || stale || ignite.phase !== 'idle');
  const saveText = saveError ?? (savedAt ? `Saved ${formatTime(savedAt)}` : 'All changes saved');

  return (
    <AdminShell
      fullBleed
      phone={{
        back: { label: 'Forms', onClick: () => navigate('/') },
        title: name,
        subtitle: (
          <>
            {statusLabel ? (
              <span
                className={`slate-m-status${pillLive ? ' slate-m-status--live' : pillStale ? ' slate-m-status--stale' : pillClosed ? ' slate-m-status--closed' : ''}`}
              >
                {statusLabel}
              </span>
            ) : null}
            <span className={saveError ? 'slate-m-save slate-m-save--err' : 'slate-m-save'}>
              {saveText}
            </span>
          </>
        ),
        menu: [
          {
            id: 'preview',
            label: 'Test the form',
            hint: 'Full screen',
            icon: <IconPlay />,
            onSelect: () => navigate(`/forms/${formId}/preview`),
          },
          {
            id: 'responses',
            label: 'Responses',
            icon: <IconChart />,
            onSelect: () => navigate(`/forms/${formId}/submissions`),
          },
          {
            id: 'undo',
            label: 'Undo',
            icon: <span className="slate-m-glyph">↶</span>,
            onSelect: undo,
          },
          {
            id: 'redo',
            label: 'Redo',
            icon: <span className="slate-m-glyph">↷</span>,
            onSelect: redo,
          },
        ],
        actions: (
          <>
            <button
              type="button"
              className={`slate-btn${needsPublish ? '' : ' slate-btn--primary'}`}
              onClick={() => void handleShare()}
            >
              <IconLink /> Share
            </button>
            {needsPublish ? (
              <PublishButton phase={ignite.phase} onClick={quickPublish}>
                {isPublished ? 'Republish' : 'Publish'}
              </PublishButton>
            ) : null}
          </>
        ),
      }}
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
            className={`slate-save-status${saveError ? ' slate-save-status--err' : ''}`}
            title="Edits save automatically"
          >
            {saveError ?? (savedAt ? `Saved ${formatTime(savedAt)}` : 'All changes saved')}
          </span>
          {statusLabel ? (
            <FlipPill
              label={statusLabel}
              className={`slate-pub-pill${
                pillLive
                  ? ' slate-pub-pill--live'
                  : pillStale
                    ? ' slate-pub-pill--stale'
                    : pillClosed
                      ? ' slate-pub-pill--closed'
                      : ''
              }`}
              title={
                pillClosed
                  ? 'Not taking responses — change it in Share'
                  : pillStale
                    ? 'Public link is serving an older snapshot'
                    : pillLive
                      ? 'Public fill link is live'
                      : 'Not published yet'
              }
            />
          ) : null}
          <button
            type="button"
            className="slate-btn slate-btn--icon slate-shortcuts-btn"
            onClick={() => setShortcutsOpen(true)}
            aria-label="Keyboard shortcuts"
            title="Shortcuts (⌘/)"
            data-slate-sound="none"
          >
            ⌘
          </button>
          <button
            type="button"
            className="slate-btn"
            onClick={() => navigate(`/forms/${formId}/submissions`)}
          >
            Responses
          </button>
          <button type="button" className="slate-btn" onClick={() => void handleShare()}>
            Share
          </button>
          {needsPublish ? (
            // Only while there is something to push (or the ignition is still
            // playing). Live + current → Share alone.
            <PublishButton phase={ignite.phase} onClick={quickPublish}>
              {isPublished ? 'Republish' : 'Publish'}
            </PublishButton>
          ) : null}
          <button
            type="button"
            className={`slate-btn${cloud ? '' : ' slate-btn--primary'}`}
            onClick={() => navigate(`/forms/${formId}/preview`)}
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
      {shortcutsOpen ? (
        <div
          className="slate-dialog-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShortcutsOpen(false);
          }}
        >
          <div
            className="slate-shortcuts"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="slate-shortcuts-header">
              <h2 className="slate-shortcuts-title">Shortcuts</h2>
              <button
                type="button"
                className="slate-icon-btn"
                aria-label="Close"
                onClick={() => setShortcutsOpen(false)}
              >
                ✕
              </button>
            </header>
            <ul className="slate-shortcuts-list">
              <li>
                <kbd>⌘</kbd>
                <kbd>Z</kbd>
                <span>Undo</span>
              </li>
              <li>
                <kbd>⌘</kbd>
                <kbd>⇧</kbd>
                <kbd>Z</kbd>
                <span>Redo</span>
              </li>
              <li>
                <kbd>⌘</kbd>
                <kbd>⇧</kbd>
                <kbd>S</kbd>
                <span>Share</span>
              </li>
              <li>
                <kbd>⌘</kbd>
                <kbd>⇧</kbd>
                <kbd>P</kbd>
                <span>Preview</span>
              </li>
              <li>
                <kbd>⌘</kbd>
                <kbd>/</kbd>
                <span>This menu</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}
      <div className="slate-editor-shell">
        {aiDraft && (
          <div className="slate-ai-pill-bar" role="status">
            <span className="slate-ai-pill">Generated with AI</span>
            <button
              type="button"
              className="slate-link"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Undo generated draft?',
                  message: 'Deletes this form and returns to your forms list.',
                  confirmLabel: 'Undo',
                  danger: true,
                });
                if (!ok) return;
                permanentlyDeleteForm(formId);
                clearAiDraft();
                setAiDraft(false);
                navigate('/');
              }}
            >
              Undo
            </button>
          </div>
        )}
        {issues.length > 0 && (
          <div className="slate-editor-alert" role="alert">
            <strong>
              {issues.length} schema {issues.length === 1 ? 'issue' : 'issues'}:
            </strong>
            {issues.map((issue, i) => (
              <button
                key={i}
                type="button"
                className="slate-link"
                style={{ fontSize: 13 }}
                onClick={() => {
                  setSelectedId(issue.questionId);
                  if (phone) setPhoneTab('edit');
                }}
              >
                {issue.message}
              </button>
            ))}
          </div>
        )}

        <EditorLayoutShell
          phoneTab={phone ? phoneTab : undefined}
          onPhoneTabChange={setPhoneTab}
          editLabel={isWelcome ? 'Welcome' : isThanks ? 'Ending' : 'Question'}
          outline={
            <Outline
              schema={schema}
              selectedId={selectedQuestion.id}
              phone={phone}
              onSelect={(id) => {
                setSelectedId(id);
                // On a phone, picking a question opens it.
                if (phone) setPhoneTab('edit');
              }}
              onAddQuestion={(type) => {
                addQuestion(type);
                if (phone) setPhoneTab('edit');
              }}
              onReorder={reorder}
              onMove={moveTo}
              onDuplicate={duplicateQuestion}
              onBulkDelete={bulkDelete}
              name={name}
              onNameChange={handleNameChange}
              onBrandChange={(v) => patchSchema({ brand: { ...schema.brand, name: v } })}
              onLogoChange={(v) => patchSchema({ brand: withBrandLogo(schema.brand, v) })}
              onThemeChange={(v: ThemeName) => patchSchema({ theme: v })}
              onThemeModeChange={(v: ThemeMode) => patchSchema({ themeMode: v })}
              onSoundChange={(v: FormSound) => {
                patchSchema({ sound: v === 'off' ? undefined : v });
                if (v !== 'off') playFormSound(v);
              }}
            />
          }
          canvas={<Canvas formId={formId} schema={schema} selectedQuestion={selectedQuestion} />}
          inspector={
            <Inspector
              question={selectedQuestion}
              allQuestions={schema.questions}
              onChange={(patch) => updateQuestion(selectedQuestion.id, patch)}
              estimate={schema.estimate}
              onEstimateChange={(next) => patchSchema({ estimate: next })}
              onAddOutOfAreaEnding={addOutOfAreaEnding}
              formId={formId}
              onDelete={async () => {
                const titleText =
                  'title' in selectedQuestion && typeof selectedQuestion.title === 'string'
                    ? selectedQuestion.title
                    : selectedQuestion.id;
                const ok = await confirm({
                  title: 'Delete this item?',
                  message: (
                    <>
                      Removes <strong>{titleText}</strong> from this form. Existing responses for it
                      stay in localStorage but won&apos;t be collected anymore.
                    </>
                  ),
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) removeQuestion(selectedQuestion.id);
              }}
              canDelete={canDelete}
            />
          }
        />
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
      return { id, type, title: 'Upload a file', maxSizeMb: 32, multiple: true, maxFiles: 10 };
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
    case 'contact_info':
      return { id, type, title: 'How can we reach you?' };
    case 'address':
      return { id, type, title: 'What’s the address?', required: true };
    case 'signature':
      return { id, type, title: 'Sign here', required: true };
    // Wave C (ADR-065)
    case 'image_pin':
      return { id, type, title: 'Where’s the problem? Tap the photo.', required: true, maxPins: 3 };
    case 'voice_note':
      return {
        id,
        type,
        title: 'Tell us about it in your own words',
        body: 'Tap record and talk — up to a minute.',
        maxSeconds: 60,
      };
    case 'location':
      return { id, type, title: 'Where’s the job?', required: true, radius: 25, radiusUnit: 'mi' };
    case 'photo_checklist':
      return {
        id,
        type,
        title: 'Snap a few photos for us',
        items: [
          { label: 'Front of the house', value: 'front' },
          { label: 'Roof close-up', value: 'roof' },
          { label: 'Electrical panel', value: 'panel' },
        ],
      };
    case 'availability':
      return {
        id,
        type,
        title: 'When are you free for a visit?',
        required: true,
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        startTime: '08:00',
        endTime: '18:00',
        slotMinutes: 60,
      };
    // Wave D (ADR-066)
    case 'signup_slots': {
      const morning = newSlotValue([]);
      return {
        id,
        type,
        title: 'Pick a time that works for you',
        slots: [
          { label: 'Morning', value: morning, capacity: 8, start: '10:00', end: '11:00' },
          {
            label: 'Afternoon',
            value: newSlotValue([morning]),
            capacity: 8,
            start: '14:00',
            end: '15:00',
          },
        ],
      };
    }
  }
}
