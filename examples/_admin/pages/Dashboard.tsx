import { useEffect, useRef, useState } from 'react';
import { defineSchema } from '@/index.js';
import {
  createFormAsync,
  duplicateForm,
  emptyFormTrash,
  getFormQuota,
  isAtFormQuota,
  listForms,
  listTrashedForms,
  permanentlyDeleteForm,
  probeFormsStorage,
  resetFormsStorage,
  restoreAllForms,
  restoreForm,
  subscribe,
  trashForm,
  updateForm,
  type FormRecord,
} from '../_formsStore.js';
import {
  countSubmissions,
  lastSubmissionAt,
  probeSubmissionsStorage,
  resetSubmissionsStorage,
} from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { isDefaultFormName } from '../formName.js';
import { usePromptFormTitle } from '../promptFormTitle.js';
import { SharePanel } from '../components/SharePanel.js';
import {
  FormCardIconBtn,
  IconDelete,
  IconDuplicate,
  IconEdit,
  IconPreview,
  IconResponses,
  IconShare,
} from '../components/FormCardIcons.js';
import { AdminShell } from '../shell/AdminShell.js';
import {
  animateFormGridDuplicate,
  captureFormCardRects,
  shouldAnimateFormGrid,
} from '../formGridFlip.js';
import { isNeonConfigured } from '../neon/env.js';
import { refreshFormsRemote } from '../neon/formsRemote.js';
import { FORM_QUOTA_MAX, formQuotaUserMessage, isFormQuotaError } from '../formQuota.js';
import { BuildWithAiModal, SparkleIcon } from '../components/BuildWithAiModal.js';
import { markAiDraft, type GeneratedDraft } from '../ai/client.js';

export function Dashboard() {
  const [forms, setForms] = useState<FormRecord[]>(() => listForms());
  const [trashed, setTrashed] = useState<FormRecord[]>(() => listTrashedForms());
  const [view, setView] = useState<'forms' | 'trash'>('forms');
  const [storageIssue, setStorageIssue] = useState<'forms' | 'submissions' | 'both' | null>(
    () => {
      const formsBad = probeFormsStorage() === 'corrupt';
      const subsBad = probeSubmissionsStorage() === 'corrupt';
      if (formsBad && subsBad) return 'both';
      if (formsBad) return 'forms';
      if (subsBad) return 'submissions';
      return null;
    },
  );
  const confirm = useConfirm();
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribe(() => {
        setForms(listForms());
        setTrashed(listTrashedForms());
      }),
    [],
  );

  // Sync immediately on mount (covers subscribe-after-hydrate races). Soft
  // refresh on focus recovers from rare empty-cache glitches — hydrate never
  // clobbers a warm cache with an empty fetch anymore.
  useEffect(() => {
    setForms(listForms());
    setTrashed(listTrashedForms());
  }, []);

  useEffect(() => {
    if (!isNeonConfigured()) return;
    let cancelled = false;
    let lastPull = 0;
    const refresh = () => {
      const now = Date.now();
      // Debounce focus + visibilitychange (both fire on tab return).
      if (now - lastPull < 2500) return;
      lastPull = now;
      void refreshFormsRemote()
        .then(() => {
          if (cancelled) return;
          setForms(listForms());
          setTrashed(listTrashedForms());
        })
        .catch((err) => {
          console.warn('[slate] Forms refresh failed', err);
        });
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    // Boot hydrate already loaded forms — only refresh when the tab returns.
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const handleDuplicate = (sourceId: string) => {
    void (async () => {
      if (isAtFormQuota()) {
        await showQuotaDialog();
        return;
      }
      const grid = gridRef.current;
      const before = grid && shouldAnimateFormGrid() ? captureFormCardRects(grid) : null;
      const created = duplicateForm(sourceId);
      if (!created) {
        if (isAtFormQuota()) await showQuotaDialog();
        return;
      }
      if (grid && before) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            animateFormGridDuplicate(grid, sourceId, created.id, before);
          });
        });
      }
    })();
  };

  const [creating, setCreating] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const quota = getFormQuota();

  const showQuotaDialog = async () => {
    const current = getFormQuota();
    const trashCount = listTrashedForms().length;
    const openTrash = trashCount > 0;
    const ok = await confirm({
      title: 'Form limit reached',
      message: formQuotaUserMessage(
        current ?? { used: FORM_QUOTA_MAX, max: FORM_QUOTA_MAX },
        trashCount,
      ),
      confirmLabel: openTrash ? 'Open Trash' : 'OK',
      cancelLabel: openTrash ? 'OK' : 'Close',
    });
    if (ok && openTrash) setView('trash');
  };

  const onNew = () => {
    if (creating) return;
    if (isAtFormQuota()) {
      void showQuotaDialog();
      return;
    }
    setCreating(true);
    void (async () => {
      try {
        const created = await createFormAsync({
          name: 'Untitled form',
          schema: defineSchema({
            // Brand starts matching the form name so the sync logic in
            // FormEditor can detect "user hasn't customized brand" and follow
            // along when they rename the form. See FormEditorBody.handleNameChange.
            brand: { name: 'Untitled form' },
            theme: 'swiss',
            themeMode: 'toggle',
            questions: [
              { id: 'welcome', type: 'welcome', title: 'Welcome.', cta: 'Start' },
              { id: 'q1', type: 'short_text', title: 'First question?', required: true },
              { id: 'done', type: 'thanks', title: "You're all set.", cta: 'Submit another' },
            ],
          }),
        });
        if (created) {
          navigate(`/forms/${created.id}/edit`);
          return;
        }
        await confirm({
          title: 'Could not create form',
          message: 'The cloud did not save the new form. Check your connection and try again.',
          confirmLabel: 'OK',
          danger: false,
        });
      } catch (err) {
        if (isFormQuotaError(err)) {
          await showQuotaDialog();
          return;
        }
        await confirm({
          title: 'Could not create form',
          message: 'The cloud did not save the new form. Check your connection and try again.',
          confirmLabel: 'OK',
          danger: false,
        });
      } finally {
        setCreating(false);
      }
    })();
  };

  const openAi = () => {
    if (isAtFormQuota()) {
      void showQuotaDialog();
      return;
    }
    setAiOpen(true);
  };

  const onAiReady = async (draft: GeneratedDraft) => {
    if (isAtFormQuota()) {
      setAiOpen(false);
      await showQuotaDialog();
      throw new Error('Form limit reached.');
    }
    try {
      const created = await createFormAsync({
        name: draft.name,
        schema: defineSchema(draft.schema),
      });
      if (created) {
        markAiDraft(created.id);
        setAiOpen(false);
        navigate(`/forms/${created.id}/edit`);
        return;
      }
      throw new Error('The cloud did not save the generated draft. Check your connection and try again.');
    } catch (err) {
      if (isFormQuotaError(err)) {
        setAiOpen(false);
        await showQuotaDialog();
        throw err;
      }
      throw err instanceof Error ? err : new Error('Could not save the draft.');
    }
  };

  return (
    <AdminShell
      crumbs={<span className="slate-crumb">Forms</span>}
      rightSlot={
        <div className="slate-header-actions">
          <button
            type="button"
            className="slate-btn"
            onClick={openAi}
            disabled={creating}
            title={quota && quota.used >= quota.max ? `Limit of ${quota.max} forms reached` : undefined}
          >
            <SparkleIcon /> Build with AI
          </button>
          <button
            type="button"
            className="slate-btn slate-btn--new"
            onClick={onNew}
            disabled={creating}
            title={quota && quota.used >= quota.max ? `Limit of ${quota.max} forms reached` : undefined}
          >
            <span className="slate-btn-plus">+</span> {creating ? 'Creating…' : 'New form'}
          </button>
        </div>
      }
    >
      <BuildWithAiModal open={aiOpen} onClose={() => setAiOpen(false)} onReady={onAiReady} />
      {storageIssue && (
        <div
          role="alert"
          className="slate-card"
          style={{
            marginBottom: 20,
            padding: 16,
            borderColor: 'var(--slate-error)',
            background: 'color-mix(in srgb, var(--slate-error) 8%, var(--chrome-panel))',
          }}
        >
          <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--slate-error)' }}>
            localStorage data could not be read
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--slate-muted)' }}>
            {storageIssue === 'both'
              ? 'Saved forms and responses appear corrupted. You can reset storage to start fresh.'
              : storageIssue === 'forms'
                ? 'Saved forms appear corrupted. Responses may still be intact.'
                : 'Saved responses appear corrupted. Your forms may still be intact.'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="slate-btn slate-btn--danger"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Reset local storage?',
                  message: 'Deletes all forms and responses saved in this browser. There is no undo.',
                  confirmLabel: 'Reset storage',
                  danger: true,
                });
                if (!ok) return;
                if (storageIssue === 'forms' || storageIssue === 'both') resetFormsStorage();
                if (storageIssue === 'submissions' || storageIssue === 'both') {
                  resetSubmissionsStorage();
                }
                setForms(listForms());
                setStorageIssue(null);
              }}
            >
              Reset storage
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <h1 className="slate-page-title">{view === 'trash' ? 'Trash' : 'Your forms'}</h1>
        <p className="slate-page-sub">
          {view === 'trash'
            ? trashed.length === 0
              ? 'No deleted forms.'
              : `${trashed.length} deleted ${trashed.length === 1 ? 'form' : 'forms'}`
            : forms.length === 0 && trashed.length === 0
              ? quota
                ? `No forms yet · ${quota.max} form limit`
                : 'No forms yet.'
              : forms.length === 0
                ? `No active forms · ${trashed.length} in trash${quota ? ` · ${quota.used} of ${quota.max}` : ''}`
                : `${forms.length} ${forms.length === 1 ? 'form' : 'forms'}${
                    quota ? ` · ${quota.used} of ${quota.max}` : ''
                  }${trashed.length > 0 ? ` · ${trashed.length} in trash` : ''}`}
        </p>
        <div className="slate-dash-tabs" role="tablist" aria-label="Forms library">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'forms'}
            className={`slate-btn slate-btn--compact${view === 'forms' ? ' slate-btn--primary' : ''}`}
            onClick={() => setView('forms')}
          >
            Forms{forms.length > 0 ? ` (${forms.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'trash'}
            className={`slate-btn slate-btn--compact${view === 'trash' ? ' slate-btn--primary' : ''}`}
            onClick={() => setView('trash')}
          >
            Trash{trashed.length > 0 ? ` (${trashed.length})` : ''}
          </button>
        </div>
      </div>

      {view === 'trash' ? (
        trashed.length === 0 ? (
          <div className="slate-empty slate-empty--start">
            <p className="slate-empty-title">Trash is empty</p>
            <p className="slate-empty-copy">Deleted forms show up here until you restore or remove them forever.</p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="slate-btn"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Restore ${trashed.length} ${trashed.length === 1 ? 'form' : 'forms'}?`,
                    message: 'Moves everything in Trash back to your forms list.',
                    confirmLabel: 'Restore all',
                  });
                  if (ok) restoreAllForms();
                }}
              >
                Restore all
              </button>
              <button
                type="button"
                className="slate-btn slate-btn--danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${trashed.length} ${trashed.length === 1 ? 'form' : 'forms'} forever?`,
                    message:
                      'Permanently removes trashed forms and their responses from localStorage. This cannot be undone.',
                    confirmLabel: 'Empty trash',
                    danger: true,
                  });
                  if (ok) {
                    emptyFormTrash();
                    setView('forms');
                  }
                }}
              >
                Empty trash
              </button>
            </div>
            <div className="slate-form-grid">
              {trashed.map((f) => (
                <TrashedFormCard
                  key={f.id}
                  form={f}
                  onRestore={async () => {
                    const ok = await confirm({
                      title: `Restore "${f.name}"?`,
                      message: 'Moves this form and its responses back to your dashboard.',
                      confirmLabel: 'Restore',
                    });
                    if (ok) restoreForm(f.id);
                  }}
                  onDeleteForever={async () => {
                    const ok = await confirm({
                      title: `Delete "${f.name}" forever?`,
                      message:
                        'Permanently removes this form and all its responses from localStorage.',
                      confirmLabel: 'Delete forever',
                      danger: true,
                    });
                    if (ok) permanentlyDeleteForm(f.id);
                  }}
                />
              ))}
            </div>
          </>
        )
      ) : forms.length === 0 ? (
        <div className="slate-empty slate-empty--start">
          <div className="slate-empty-mark" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <p className="slate-empty-title">
            {trashed.length > 0 ? 'Nothing active right now' : 'Your library is empty'}
          </p>
          <p className="slate-empty-copy">
            {trashed.length > 0
              ? 'Restore a form from Trash, or start a new one from the top right.'
              : 'Build with AI or New form live in the top right — pick whichever fits.'}
          </p>
        </div>
      ) : (
        <div ref={gridRef} className="slate-form-grid">
          {forms.map((f) => (
            <FormCard
              key={f.id}
              form={f}
              onDuplicate={() => handleDuplicate(f.id)}
              onDelete={async () => {
                const ok = await confirm({
                  title: `Move "${f.name}" to trash?`,
                  message:
                    'The form and its responses stay in Trash until you empty it. You can restore later.',
                  confirmLabel: 'Move to trash',
                  danger: true,
                });
                if (ok) trashForm(f.id);
              }}
            />
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function TrashedFormCard({
  form,
  onRestore,
  onDeleteForever,
}: {
  form: FormRecord;
  onRestore: () => void;
  onDeleteForever: () => void;
}) {
  const subCount = countSubmissions(form.id);
  const trashedAt = form.deletedAt ? timeAgo(new Date(form.deletedAt)) : null;

  return (
    <div className="slate-card">
      <div className="slate-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <span className="slate-card-title">{form.name}</span>
          <p className="slate-card-meta">
            {form.schema.brand.name} · {String(form.schema.theme)}
            {trashedAt ? ` · trashed ${trashedAt}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="slate-badge">
            {subCount} {subCount === 1 ? 'response' : 'responses'} kept
          </span>
        </div>
      </div>
      <div className="slate-card-footer">
        <div className="slate-card-toolbar" role="toolbar" aria-label={`Trash actions for ${form.name}`}>
          <button type="button" className="slate-btn slate-btn--compact" onClick={onRestore}>
            Restore
          </button>
          <button type="button" className="slate-btn slate-btn--compact slate-btn--danger" onClick={onDeleteForever}>
            Delete forever
          </button>
        </div>
      </div>
    </div>
  );
}

function FormCard({
  form,
  onDuplicate,
  onDelete,
}: {
  form: FormRecord;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [shareName, setShareName] = useState(form.name);
  const promptFormTitle = usePromptFormTitle();
  const subCount = countSubmissions(form.id);
  const lastAt = lastSubmissionAt(form.id);
  const qCount = form.schema.questions.filter(
    (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
  ).length;

  const handleShare = async () => {
    let nextName = form.name;
    if (isDefaultFormName(nextName)) {
      const titled = await promptFormTitle();
      if (!titled) return;
      const schema =
        form.schema.brand.name === form.name
          ? { ...form.schema, brand: { ...form.schema.brand, name: titled } }
          : form.schema;
      const [updated] = updateForm(form.id, { name: titled, schema });
      if (!updated) return;
      nextName = titled;
    }
    setShareName(nextName);
    setShareOpen(true);
  };

  return (
    <div className="slate-card" data-form-card data-form-id={form.id}>
      <button
        type="button"
        className="slate-card-body-btn"
        onClick={() => navigate(`/forms/${form.id}/edit`)}
        aria-label={`Open ${form.name}`}
      >
        <div className="slate-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span className="slate-card-title">{form.name}</span>
            <p className="slate-card-meta">
              {form.schema.brand.name} · {String(form.schema.theme)}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="slate-badge">{qCount} {qCount === 1 ? 'question' : 'questions'}</span>
            <span className={`slate-badge${subCount > 0 ? ' slate-badge--accent' : ''}`}>
              {subCount} {subCount === 1 ? 'response' : 'responses'}
            </span>
            {lastAt && (
              <span className="slate-badge">last {timeAgo(new Date(lastAt))}</span>
            )}
          </div>
        </div>
      </button>

      <div className="slate-card-footer">
        <div className="slate-card-toolbar" role="toolbar" aria-label={`Actions for ${form.name}`}>
          <FormCardIconBtn label="Edit" onClick={() => navigate(`/forms/${form.id}/edit`)}>
            <IconEdit />
          </FormCardIconBtn>
          <FormCardIconBtn label="Share" sound="open" onClick={() => void handleShare()}>
            <IconShare />
          </FormCardIconBtn>
          <FormCardIconBtn
            label={subCount > 0 ? `Responses (${subCount})` : 'Responses'}
            badge={subCount}
            onClick={() => navigate(`/forms/${form.id}/submissions`)}
          >
            <IconResponses />
          </FormCardIconBtn>
          <FormCardIconBtn label="Preview" onClick={() => navigate(`/forms/${form.id}`)}>
            <IconPreview />
          </FormCardIconBtn>
          <FormCardIconBtn label="Duplicate" sound="create" onClick={onDuplicate}>
            <IconDuplicate />
          </FormCardIconBtn>
          <FormCardIconBtn label="Move to trash" danger onClick={onDelete}>
            <IconDelete />
          </FormCardIconBtn>
        </div>
      </div>

      <SharePanel
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        formId={form.id}
        formName={shareName}
        schema={form.schema}
      />
    </div>
  );
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
