/**
 * Studio chrome: refresh library + cross-form response notifications.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getForm, listForms } from '../_formsStore.js';
import { listSubmissions, subscribe as subscribeSubmissions } from '../_submissionStore.js';
import { isNeonConfigured } from '../neon/env.js';
import { isStoresHydrated } from '../neon/hydrate.js';
import { refreshFormsRemote } from '../neon/formsRemote.js';
import { refreshSubmissionsRemote } from '../neon/submissionsRemote.js';
import { leadPreview, formatSubmittedAt } from '../responsesFormat.js';
import { navigate } from '../_router.js';
import { playUiSound } from '../uiSounds.js';
import { useToast } from '../toast.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';

const KNOWN_KEY = 'slate-admin-known-subs';
const UNREAD_KEY = 'slate-admin-unread-subs';
const POLL_MS = 15000;
const FEED_LIMIT = 24;

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids.slice(0, 2000)));
  } catch {
    // ignore quota
  }
}

function IconRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={spinning ? 'slate-spin' : undefined}
    >
      <path
        d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M3 4.5V9h4.5M21 19.5V15H16.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function StudioInbox() {
  const toast = useToast();
  const [spinning, setSpinning] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 64, right: 20 });
  const [unread, setUnread] = useState<string[]>(() => readIds(UNREAD_KEY));
  const [tick, setTick] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const pulling = useRef(false);

  const ingest = useCallback((announce: boolean) => {
    const active = listSubmissions();
    const ids = active.map((s) => s.id);
    const known = readIds(KNOWN_KEY);
    if (!seeded.current && known.length === 0 && !window.localStorage.getItem(KNOWN_KEY)) {
      writeIds(KNOWN_KEY, ids);
      seeded.current = true;
      setTick((n) => n + 1);
      return;
    }
    seeded.current = true;
    const knownSet = new Set(known);
    const fresh = ids.filter((id) => !knownSet.has(id));
    if (fresh.length === 0) {
      setTick((n) => n + 1);
      return;
    }
    const nextUnread = [...fresh, ...readIds(UNREAD_KEY).filter((id) => !fresh.includes(id))].slice(0, 200);
    writeIds(UNREAD_KEY, nextUnread);
    writeIds(KNOWN_KEY, [...fresh, ...known]);
    setUnread(nextUnread);
    setTick((n) => n + 1);
    if (announce) {
      playUiSound('refresh');
      const first = active.find((s) => s.id === fresh[0]);
      const formName = first ? getForm(first.formId)?.name : undefined;
      toast.push({
        title: fresh.length === 1 ? 'New response' : `${fresh.length} new responses`,
        detail: formName ?? 'Across your forms',
        tone: 'success',
        sound: 'none',
      });
    }
  }, [toast]);

  const pull = useCallback(
    async (announce: boolean) => {
      if (pulling.current) return;
      if (!isNeonConfigured() || !isStoresHydrated()) {
        ingest(announce);
        return;
      }
      pulling.current = true;
      try {
        await Promise.all([refreshFormsRemote(), refreshSubmissionsRemote()]);
      } catch (err) {
        console.warn('[slate] Studio refresh failed', err);
      } finally {
        pulling.current = false;
        ingest(announce);
      }
    },
    [ingest],
  );

  useEffect(() => {
    ingest(false);
    return subscribeSubmissions(() => ingest(false));
  }, [ingest]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void pull(true);
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void pull(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [pull]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        top: rect.bottom + 8,
        right: Math.max(12, window.innerWidth - rect.right),
      });
    };
    place();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const onRefresh = async () => {
    if (spinning) return;
    setSpinning(true);
    await pull(false);
    playUiSound('refresh');
    setSpinning(false);
  };

  const feed = useMemo(() => {
    const forms = new Map(listForms().map((f) => [f.id, f]));
    return listSubmissions()
      .slice()
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
      .slice(0, FEED_LIMIT)
      .map((sub) => {
        const form = forms.get(sub.formId) ?? getForm(sub.formId);
        const questions = (form?.schema.questions ?? []).filter(
          (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
        );
        const lead = leadPreview(questions, sub.answers as Record<string, unknown>);
        return {
          id: sub.id,
          formId: sub.formId,
          formName: form?.name ?? 'Untitled form',
          preview: lead.primary === '—' ? 'New response' : lead.primary,
          when: formatSubmittedAt(sub.receivedAt),
          unread: unread.includes(sub.id),
        };
      });
  }, [unread, tick]);

  const unreadCount = unread.length;

  const markAllRead = () => {
    writeIds(UNREAD_KEY, []);
    setUnread([]);
  };

  const openItem = (id: string, formId: string) => {
    const next = unread.filter((x) => x !== id);
    writeIds(UNREAD_KEY, next);
    setUnread(next);
    setOpen(false);
    navigate(`/forms/${formId}/submissions`);
  };

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  return (
    <>
      <button
        type="button"
        className="slate-btn slate-btn--icon"
        onClick={() => void onRefresh()}
        disabled={spinning}
        aria-label="Refresh"
        title="Refresh"
        data-slate-sound="none"
      >
        <IconRefresh spinning={spinning} />
      </button>
      <button
        ref={btnRef}
        type="button"
        className={`slate-btn slate-btn--icon slate-inbox-btn${open ? ' slate-inbox-btn--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        data-slate-sound="open"
      >
        <IconBell />
        {unreadCount > 0 ? (
          <span className="slate-inbox-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        ) : null}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div data-slate-forms="" data-theme-name="slate" data-admin-ui={uiTheme} data-theme={mode}>
              <div
                ref={panelRef}
                className="slate-inbox"
                role="dialog"
                aria-label="Notifications"
                style={{ top: anchor.top, right: anchor.right }}
              >
                <header className="slate-inbox-header">
                  <h2 className="slate-inbox-title">Notifications</h2>
                  {unreadCount > 0 ? (
                    <button type="button" className="slate-link" data-slate-sound="none" onClick={markAllRead}>
                      Mark all read
                    </button>
                  ) : null}
                </header>
                {feed.length === 0 ? (
                  <p className="slate-inbox-empty">Responses from your forms show up here as they come in.</p>
                ) : (
                  <ul className="slate-inbox-list">
                    {feed.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`slate-inbox-item${row.unread ? ' slate-inbox-item--unread' : ''}`}
                          data-slate-sound="none"
                          onClick={() => openItem(row.id, row.formId)}
                        >
                          <span className="slate-inbox-form">{row.formName}</span>
                          <span className="slate-inbox-preview">{row.preview}</span>
                          <span className="slate-inbox-when">{row.when}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
