/**
 * Responses page (ADR-055). The shell loads a form's responses (ADR-049),
 * owns every write — read state, trash, restore, delete — and hosts two
 * views behind a persisted toggle: Inbox (split list + reader) and Summary
 * (numbers and charts first). Trash is a mode of the Inbox, not a view.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { getForm, subscribe as subscribeForms, hasUnpublishedChanges } from '../_formsStore.js';
import {
  emptyTrash,
  ensureFormSubmissions,
  isFormSubmissionsReady,
  listSubmissions,
  listTrashedSubmissions,
  permanentlyDeleteSubmission,
  restoreSubmission,
  restoreSubmissions,
  subscribe as subscribeSubmissions,
  trashSubmission,
  trashSubmissions,
  type StoredSubmission,
} from '../_submissionStore.js';
import { navigate } from '../_router.js';
import { useConfirm } from '../_confirm.js';
import { AdminShell } from '../shell/AdminShell.js';
import { downloadResponsesCsv } from '../csvExport.js';
import { isNeonConfigured } from '../neon/env.js';
import { refreshSubmissionsRemote } from '../neon/submissionsRemote.js';
import { isStoresHydrated } from '../neon/hydrate.js';
import { SharePanel } from '../components/SharePanel.js';
import { useToast } from '../toast.js';
// Shared sheet first: the views' own sheets (imported with them) build on it.
import '../responses/responses.css';
import { answerQuestions, respondentName } from '../responses/model.js';
import { markRead, markUnread, readUnread, useUnread } from '../responses/unreadStore.js';
import { usePhone } from '../responses/hooks.js';
import { MoreMenu, type MoreMenuItem } from '../responses/MoreMenu.js';
import { ResponsesInbox } from '../responses/ResponsesInbox.js';
import { ResponsesSummary } from '../responses/ResponsesSummary.js';
import { ResponsesSkeleton } from '../responses/ResponsesSkeleton.js';
import type { ResponsesViewName } from '../responses/types.js';
import {
  IconArrowLeft,
  IconDownload,
  IconEdit,
  IconEye,
  IconInbox,
  IconShare,
  IconSummary,
  IconTrash,
} from '../responses/icons.js';

type Props = { formId: string };

/** Which view the owner last picked, per browser. */
export const RESPONSES_VIEW_KEY = 'slate-responses-view';
/** Refresh from the cloud at most this often (open + tab focus). */
const PULL_THROTTLE_MS = 2500;

function readView(): ResponsesViewName {
  try {
    return window.localStorage.getItem(RESPONSES_VIEW_KEY) === 'summary' ? 'summary' : 'inbox';
  } catch {
    return 'inbox';
  }
}

function writeView(view: ResponsesViewName): void {
  try {
    window.localStorage.setItem(RESPONSES_VIEW_KEY, view);
  } catch {
    // ignored — the toggle still works for this visit
  }
}

function newestFirst(list: StoredSubmission[]): StoredSubmission[] {
  const at = (s: StoredSubmission) => Date.parse(s.receivedAt) || 0;
  return [...list].sort((a, b) => at(b) - at(a));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How much of the header trail fits: all of it, the form name, or nothing. */
type CrumbFit = 'full' | 'name' | 'none';
/** CSS px of the header's brand + crumbs cluster, brand included. */
const CRUMBS_FULL_MIN = 360;
const CRUMBS_NAME_MIN = 230;

/**
 * The studio header is shared, and its actions leave this page's trail
 * less room on tablets, at larger studio sizes and in cloud mode (Sign
 * out). On this page the brand + crumbs cluster takes whatever room is
 * left (responses.css); measure it and pick a trail. With none, the
 * toolbar shows the form name under the title, as on phones.
 */
function useCrumbFit(anchor: RefObject<HTMLElement | null>, mounted: boolean): CrumbFit {
  const [fit, setFit] = useState<CrumbFit>('full');
  useLayoutEffect(() => {
    const cluster = anchor.current
      ?.closest('[data-slate-forms]')
      ?.querySelector<HTMLElement>('.slate-header > div:first-child');
    if (!cluster) return;
    const measure = () => {
      // offsetWidth is in CSS px, so the thresholds hold at every studio size.
      const room = cluster.offsetWidth;
      if (room === 0) return; // not laid out (hidden, or no layout engine)
      setFit(room >= CRUMBS_FULL_MIN ? 'full' : room >= CRUMBS_NAME_MIN ? 'name' : 'none');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(cluster);
    return () => observer.disconnect();
  }, [anchor, mounted]);
  return fit;
}

export function FormSubmissions({ formId }: Props) {
  const [form, setForm] = useState(() => getForm(formId));
  const [activeRaw, setActiveRaw] = useState<StoredSubmission[]>(() => listSubmissions(formId));
  const [trashedRaw, setTrashedRaw] = useState<StoredSubmission[]>(() =>
    listTrashedSubmissions(formId),
  );
  /** Cloud: answers load per form on open (ADR-049). Offline: always ready. */
  const [ready, setReady] = useState(() => isFormSubmissionsReady(formId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [view, setView] = useState<ResponsesViewName>(readView);
  const [trashMode, setTrashMode] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const unread = useUnread();
  const phone = usePhone();
  const rootRef = useRef<HTMLDivElement>(null);
  const crumbFit = useCrumbFit(rootRef, Boolean(form));
  const backRef = useRef<HTMLButtonElement>(null);
  const trashBtnRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusAfterMode = useRef<'back' | 'trash' | null>(null);

  const refresh = useCallback(() => {
    setForm(getForm(formId));
    setActiveRaw(listSubmissions(formId));
    setTrashedRaw(listTrashedSubmissions(formId));
    setReady(isFormSubmissionsReady(formId));
  }, [formId]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void ensureFormSubmissions(formId, { force: loadAttempt > 0 })
      .then(() => {
        if (!cancelled) refresh();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[slate] Could not load responses', err);
        setLoadError('Couldn’t load responses. Check your connection and try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [formId, loadAttempt, refresh]);

  useEffect(() => {
    refresh();
    const unsubForms = subscribeForms(refresh);
    const unsubSubs = subscribeSubmissions(refresh);
    return () => {
      unsubForms();
      unsubSubs();
    };
  }, [refresh]);

  // Pull latest from Neon when opening Responses / returning to the tab so
  // public share-link submits show up without a full page reload.
  useEffect(() => {
    if (!isNeonConfigured() || !isStoresHydrated()) return;
    let cancelled = false;
    let lastPull = 0;
    const pull = () => {
      const now = Date.now();
      if (now - lastPull < PULL_THROTTLE_MS) return;
      lastPull = now;
      // Only rows newer than the last one seen; the form's list was loaded above.
      void refreshSubmissionsRemote()
        .then(() => ensureFormSubmissions(formId))
        .then(() => {
          if (!cancelled) refresh();
        })
        .catch(() => {
          /* keep cache */
        });
    };
    pull();
    const onVis = () => {
      if (document.visibilityState === 'visible') pull();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [formId, refresh]);

  // Entering / leaving trash swaps the toolbar buttons; keep focus on the
  // control that replaced the one just pressed.
  useEffect(() => {
    const target = focusAfterMode.current;
    focusAfterMode.current = null;
    if (!target) return;
    // The Trash button is gone once trash and inbox are both empty.
    const el = target === 'back' ? backRef.current : (trashBtnRef.current ?? titleRef.current);
    el?.focus({ preventScroll: true });
  }, [trashMode]);

  const schemaQuestions = form?.schema.questions;
  const questions = useMemo(() => answerQuestions(schemaQuestions ?? []), [schemaQuestions]);
  const subs = useMemo(() => newestFirst(activeRaw), [activeRaw]);
  const trashed = useMemo(() => newestFirst(trashedRaw), [trashedRaw]);
  const newCount = useMemo(
    () => subs.reduce((n, s) => (unread.has(s.id) ? n + 1 : n), 0),
    [subs, unread],
  );

  const chooseView = useCallback((next: ResponsesViewName) => {
    setView(next);
    writeView(next);
  }, []);

  const enterTrash = useCallback(() => {
    focusAfterMode.current = 'back';
    setTrashMode(true);
  }, []);

  const exitTrash = useCallback(() => {
    focusAfterMode.current = 'trash';
    setTrashMode(false);
  }, []);

  /** Name for a toast line, read at action time so callbacks stay stable. */
  const describe = useCallback(
    (id: string, pool: 'active' | 'trash'): string | undefined => {
      const f = getForm(formId);
      const list = newestFirst(
        pool === 'active' ? listSubmissions(formId) : listTrashedSubmissions(formId),
      );
      const i = list.findIndex((s) => s.id === id);
      const sub = list[i];
      if (!f || !sub) return undefined;
      return respondentName(answerQuestions(f.schema.questions), sub.answers, list.length - i);
    },
    [formId],
  );

  const onMarkRead = useCallback((ids: string[]) => markRead(ids), []);
  const onMarkUnread = useCallback((id: string) => markUnread(id), []);

  const onTrash = useCallback(
    (id: string) => {
      const who = describe(id, 'active');
      const wasUnread = readUnread().includes(id);
      trashSubmission(id);
      // A trashed response shouldn't keep the bell lit; Undo puts it back.
      if (wasUnread) markRead([id]);
      toast.push({
        title: 'Moved to trash',
        detail: who,
        action: {
          label: 'Undo',
          onClick: () => {
            restoreSubmission(id);
            if (wasUnread) markUnread(id);
          },
        },
      });
    },
    [describe, toast],
  );

  const onRestore = useCallback(
    (id: string) => {
      const who = describe(id, 'trash');
      restoreSubmission(id);
      toast.push({
        title: 'Restored',
        detail: who,
        action: { label: 'Undo', onClick: () => trashSubmission(id) },
      });
    },
    [describe, toast],
  );

  const onDeleteForever = useCallback(
    (id: string) => {
      void (async () => {
        const ok = await confirm({
          title: 'Delete forever?',
          message: 'This permanently deletes the response. It can’t be undone.',
          confirmLabel: 'Delete forever',
          danger: true,
        });
        if (!ok) return;
        permanentlyDeleteSubmission(id);
        markRead([id]);
      })();
    },
    [confirm],
  );

  const onRestoreAll = useCallback(() => {
    void (async () => {
      const n = listTrashedSubmissions(formId).length;
      if (n === 0) return;
      const ok = await confirm({
        title: `Restore ${plural(n, 'response', 'responses')}?`,
        message: 'Moves everything in Trash back to Responses.',
        confirmLabel: 'Restore all',
      });
      if (!ok) return;
      restoreSubmissions(formId);
      toast.push({ title: `Restored ${plural(n, 'response', 'responses')}`, tone: 'info' });
    })();
  }, [confirm, formId, toast]);

  const onEmptyTrash = useCallback(() => {
    void (async () => {
      const ids = listTrashedSubmissions(formId).map((s) => s.id);
      if (ids.length === 0) return;
      const ok = await confirm({
        title: `Delete ${plural(ids.length, 'response', 'responses')} forever?`,
        message: 'Permanently deletes everything in Trash. This can’t be undone.',
        confirmLabel: 'Empty trash',
        danger: true,
      });
      if (!ok) return;
      emptyTrash(formId);
      markRead(ids);
    })();
  }, [confirm, formId]);

  if (!form) {
    return (
      <AdminShell crumbs={null}>
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

  const published = form.status === 'published';
  const stale = hasUnpublishedChanges(form);
  const canExport = ready && subs.length > 0;
  const showToggle = ready && !trashMode && subs.length > 0;
  const showTrashButton = !trashMode && (!ready || subs.length > 0 || trashed.length > 0);
  const editorPath = `/forms/${formId}/edit`;

  const exportCsv = () => {
    downloadResponsesCsv(form.name, questions, subs);
    toast.push({
      title: 'CSV downloaded',
      detail: plural(subs.length, 'response', 'responses'),
      tone: 'success',
      sound: 'copy',
    });
  };

  const moveAllToTrash = async () => {
    const ids = subs.map((s) => s.id);
    const ok = await confirm({
      title: `Move ${plural(ids.length, 'response', 'responses')} to trash?`,
      message: `Responses for "${form.name}" will leave the inbox but stay in Trash until you empty it.`,
      confirmLabel: 'Move to trash',
      danger: true,
    });
    if (!ok) return;
    trashSubmissions(formId);
    markRead(ids);
  };

  // Phones: the header only fits the studio's own controls, so the page's
  // header actions move into the ⋯ menu.
  const menuItems: MoreMenuItem[] = [
    ...(phone
      ? [
          {
            id: 'editor',
            label: 'Open editor',
            icon: <IconEdit />,
            onSelect: () => navigate(editorPath),
          },
          { id: 'share', label: 'Share', icon: <IconShare />, onSelect: () => setShareOpen(true) },
        ]
      : []),
    ...(phone && canExport
      ? [{ id: 'csv', label: 'Export CSV', icon: <IconDownload />, onSelect: exportCsv }]
      : []),
    {
      id: 'preview',
      label: 'Preview form',
      icon: <IconEye />,
      onSelect: () => navigate(`/forms/${formId}/preview`),
    },
    ...(!trashMode && ready && subs.length > 0
      ? [
          {
            id: 'trash-all',
            label: 'Move all to trash',
            icon: <IconTrash />,
            danger: true,
            separatorBefore: true,
            onSelect: () => void moveAllToTrash(),
          },
        ]
      : []),
  ];

  const fill =
    !phone &&
    !loadError &&
    (!ready
      ? trashMode || view === 'inbox'
      : trashMode
        ? trashed.length > 0
        : view === 'inbox' && subs.length > 0);

  const common = {
    formId,
    formName: form.name,
    questions,
    unread,
    onMarkRead,
    onMarkUnread,
    onTrash,
  };

  let body: ReactNode;
  if (!ready) {
    body = loadError ? (
      <div className="slate-empty">
        <p style={{ margin: '0 0 12px' }}>{loadError}</p>
        <button
          type="button"
          className="slate-btn slate-btn--primary"
          onClick={() => setLoadAttempt((n) => n + 1)}
        >
          Try again
        </button>
      </div>
    ) : (
      <ResponsesSkeleton view={trashMode ? 'inbox' : view} />
    );
  } else if (trashMode) {
    body =
      trashed.length === 0 ? (
        <div className="slate-empty slate-empty--start">
          <p className="slate-empty-title">Trash is empty</p>
          <p className="slate-empty-copy">
            Responses you move to trash stay here until you empty it.
          </p>
          <div className="slate-empty-actions">
            <button type="button" className="slate-btn" onClick={exitTrash}>
              Back to responses
            </button>
          </div>
        </div>
      ) : (
        <div className="rsp-view">
          <ResponsesInbox
            {...common}
            subs={trashed}
            mode="trash"
            onRestore={onRestore}
            onDeleteForever={onDeleteForever}
            onRestoreAll={onRestoreAll}
            onEmptyTrash={onEmptyTrash}
          />
        </div>
      );
  } else if (subs.length === 0) {
    body = (
      <div className="slate-empty slate-empty--start">
        <p className="slate-empty-title">
          {trashed.length > 0 ? 'Inbox is empty' : 'No responses yet'}
        </p>
        <p className="slate-empty-copy">
          {trashed.length > 0
            ? 'Restore something from Trash, or share the form again.'
            : published
              ? stale
                ? 'Link is live, but the public snapshot is behind your draft — republish from Share.'
                : 'Share your public link. New answers appear here as soon as someone submits.'
              : 'Publish from Share to get a public fill link, then send it.'}
        </p>
        <div className="slate-empty-actions">
          <button
            type="button"
            className="slate-btn slate-btn--primary"
            onClick={() => setShareOpen(true)}
          >
            {published ? (stale ? 'Republish' : 'Share link') : 'Publish & share'}
          </button>
          {trashed.length > 0 ? (
            <button type="button" className="slate-btn" onClick={enterTrash}>
              Open trash
            </button>
          ) : (
            <button
              type="button"
              className="slate-btn"
              onClick={() => navigate(`/forms/${formId}/preview`)}
            >
              Preview
            </button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="rsp-view">
        {view === 'inbox' ? (
          <ResponsesInbox
            {...common}
            subs={subs}
            mode="responses"
            onRestore={onRestore}
            onDeleteForever={onDeleteForever}
            onRestoreAll={onRestoreAll}
            onEmptyTrash={onEmptyTrash}
          />
        ) : (
          <ResponsesSummary {...common} subs={subs} />
        )}
      </div>
    );
  }

  return (
    <AdminShell
      crumbs={
        crumbFit === 'none' ? null : (
          <span className="slate-crumb rsp-crumbs">
            {crumbFit === 'full' ? (
              <>
                <button type="button" className="slate-link" onClick={() => navigate('/')}>
                  Forms
                </button>
                <span aria-hidden="true">/</span>
              </>
            ) : null}
            <button
              type="button"
              className="slate-link rsp-crumb-form"
              onClick={() => navigate(editorPath)}
              title={form.name}
            >
              {form.name}
            </button>
            {crumbFit === 'full' ? (
              <>
                <span aria-hidden="true">/</span>
                <span className="rsp-crumb-current">Responses</span>
              </>
            ) : null}
          </span>
        )
      }
      rightSlot={
        phone ? null : (
          <>
            <button type="button" className="slate-btn" onClick={() => navigate(editorPath)}>
              ← Editor
            </button>
            <button type="button" className="slate-btn" onClick={() => setShareOpen(true)}>
              Share
            </button>
            {canExport ? (
              <button type="button" className="slate-btn" onClick={exportCsv}>
                Export CSV
              </button>
            ) : null}
          </>
        )
      }
    >
      <SharePanel
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        formId={formId}
        formName={form.name}
        schema={form.schema}
      />
      <div
        ref={rootRef}
        className={`slate-rsp${fill ? ' slate-rsp--fill' : ''}${phone ? ' slate-rsp--phone' : ''}`}
      >
        <div className="rsp-toolbar">
          <div className="rsp-toolbar-lead">
            <div className="rsp-heading">
              {trashMode ? (
                <button
                  ref={backRef}
                  type="button"
                  className="rsp-textbtn rsp-back"
                  onClick={exitTrash}
                >
                  <IconArrowLeft />
                  Responses
                </button>
              ) : null}
              <h1 ref={titleRef} className="rsp-title" tabIndex={-1}>
                {trashMode ? 'Trash' : 'Responses'}
              </h1>
              {ready && trashMode && trashed.length > 0 ? (
                <span className="rsp-count">{trashed.length}</span>
              ) : null}
              {ready && !trashMode && subs.length > 0 ? (
                <span className="rsp-count">
                  <span className="rsp-sr">Total: </span>
                  {subs.length}
                </span>
              ) : null}
              {ready && !trashMode && newCount > 0 ? (
                <span className="rsp-count rsp-count--new">
                  <span className="rsp-dot" aria-hidden="true" />
                  {newCount} new
                </span>
              ) : null}
            </div>
            {phone || crumbFit === 'none' ? <p className="rsp-form-name">{form.name}</p> : null}
          </div>
          <div className="rsp-toolbar-actions">
            {showToggle ? (
              <div className="rsp-seg" role="group" aria-label="View">
                <button
                  type="button"
                  aria-pressed={view === 'inbox'}
                  onClick={() => chooseView('inbox')}
                >
                  <IconInbox />
                  Inbox
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'summary'}
                  onClick={() => chooseView('summary')}
                >
                  <IconSummary />
                  Summary
                </button>
              </div>
            ) : null}
            {showTrashButton ? (
              <button
                ref={trashBtnRef}
                type="button"
                className="rsp-textbtn"
                onClick={enterTrash}
                aria-label={
                  trashed.length > 0
                    ? `Trash, ${plural(trashed.length, 'response', 'responses')}`
                    : 'Trash'
                }
              >
                <IconTrash />
                <span className="rsp-trash-label">Trash</span>
                {trashed.length > 0 ? <span className="rsp-seg-n">{trashed.length}</span> : null}
              </button>
            ) : null}
            <MoreMenu items={menuItems} />
          </div>
        </div>
        {body}
      </div>
    </AdminShell>
  );
}
