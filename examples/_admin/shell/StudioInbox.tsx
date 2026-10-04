/**
 * Studio chrome: refresh library + cross-form response notifications.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getForm, listForms } from '../_formsStore.js';
import {
  getSubmission,
  listSubmissionIndex,
  subscribe as subscribeSubmissions,
} from '../_submissionStore.js';
import { isNeonConfigured } from '../neon/env.js';
import { isStoresHydrated } from '../neon/hydrate.js';
import { refreshFormsRemote } from '../neon/formsRemote.js';
import { refreshSubmissionsRemote } from '../neon/submissionsRemote.js';
import { leadPreview, formatSubmittedAt, formatRelativeAge } from '../responsesFormat.js';
import { navigate } from '../_router.js';
import { playUiSound } from '../uiSounds.js';
import { useToast } from '../toast.js';
import { detectAdminUiTheme } from '../adminUiTheme.js';
import { readSlateMode } from '../slateMode.js';
import {
  hasKnown,
  markRead,
  readKnown,
  readUnread,
  setUnread,
  useUnread,
  writeKnown,
} from '../responses/unreadStore.js';
import { LoadingScreen } from './LoadingScreen.js';
import { isArrival, noteArrivals, useArrivalsVersion } from '../delight/arrivals.js';
import { IconBell } from '../delight/BellIcon.js';
import { firstResponseForms, markFirstCelebrated } from '../delight/firstResponse.js';

/** 60s ± 20% so a thousand open tabs don't poll in lockstep. */
const POLL_MS = 60_000;
const pollDelay = () => POLL_MS * (0.8 + Math.random() * 0.4);
const FEED_LIMIT = 24;
/** Refresh shows the boot splash; hold it long enough for the stack to assemble. */
const REFRESH_MIN_MS = 1400;

function IconRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={spinning ? 'slate-spin slate-spin--ccw' : undefined}
    >
      {/* One counter-clockwise arrow (Caleb picked "Classic", 2026-10-03). */}
      <path
        d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StudioInbox() {
  const toast = useToast();
  const [spinning, setSpinning] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 64, right: 20 });
  // Shared with the Responses page (ADR-055): reads there clear the badge here.
  const unread = useUnread();
  const [tick, setTick] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const pulling = useRef(false);
  /**
   * True while a background poll is pulling. The pull's store update reaches
   * `ingest` through the subscription first, so this is how that ingest
   * knows to announce (otherwise it marks the rows known silently and the
   * poll's own ingest finds nothing new).
   */
  const announcing = useRef(false);
  /** Bumps to ring the bell once per batch of live arrivals (ADR-060). */
  const [ring, setRing] = useState(0);
  // Re-render the panel rows when arrivals are noted, so they wash in.
  useArrivalsVersion();

  const ingest = useCallback(
    (announce: boolean) => {
      // The slim index is complete in cloud mode; answers may not be loaded yet.
      const active = listSubmissionIndex();
      const ids = active.map((s) => s.id);
      const known = readKnown();
      if (!seeded.current && known.length === 0 && !hasKnown()) {
        writeKnown(ids);
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
      // Store caps unread at 200 and known at 2000.
      writeKnown([...fresh, ...known]);
      setUnread([...fresh, ...readUnread().filter((id) => !fresh.includes(id))]);
      setTick((n) => n + 1);

      // Live arrivals (not the batch that loads with the page): rows wash in
      // and the bell rings. The hydrate notify lands before the stores
      // report hydrated, so that first batch stays quiet.
      if (isStoresHydrated()) {
        noteArrivals(fresh);
        setRing((n) => n + 1);
      }

      // A form's very first response gets its own toast, once per form.
      const firsts = firstResponseForms(fresh, active);
      if (firsts.length > 0) {
        markFirstCelebrated(firsts);
        playUiSound('arrival');
        const names = firsts.map((id) => getForm(id)?.name ?? 'Your form');
        toast.push({
          title: firsts.length === 1 ? 'First response!' : 'First responses!',
          detail:
            names.length === 1
              ? `${names[0]} just heard back.`
              : `${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''} just heard back.`,
          tone: 'success',
          sound: 'none',
          celebrate: true,
          durationMs: 5600,
        });
        return;
      }

      if (announce) {
        playUiSound('arrival');
        const first = active.find((s) => s.id === fresh[0]);
        const formName = first ? getForm(first.formId)?.name : undefined;
        toast.push({
          title: fresh.length === 1 ? 'New response' : `${fresh.length} new responses`,
          detail: formName ?? 'Across your forms',
          tone: 'success',
          sound: 'none',
        });
      }
    },
    [toast],
  );

  const pull = useCallback(
    async (announce: boolean) => {
      if (pulling.current) return;
      if (!isNeonConfigured() || !isStoresHydrated()) {
        ingest(announce);
        return;
      }
      pulling.current = true;
      announcing.current = announce;
      try {
        // Poll: only rows newer than the last seen. Manual Refresh also reloads
        // the index so trash/deletes from another device show up.
        await Promise.all([refreshFormsRemote(), refreshSubmissionsRemote({ full: !announce })]);
      } catch (err) {
        console.warn('[slate] Studio refresh failed', err);
      } finally {
        pulling.current = false;
        announcing.current = false;
        ingest(announce);
      }
    },
    [ingest],
  );

  useEffect(() => {
    ingest(false);
    return subscribeSubmissions(() => ingest(announcing.current));
  }, [ingest]);

  useEffect(() => {
    let id = 0;
    const tick = () => {
      if (document.visibilityState === 'visible') void pull(true);
      id = window.setTimeout(tick, pollDelay());
    };
    id = window.setTimeout(tick, pollDelay());
    const onVis = () => {
      if (document.visibilityState === 'visible') void pull(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearTimeout(id);
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
    setOpen(false);
    const started = Date.now();
    await pull(false);
    const remaining = REFRESH_MIN_MS - (Date.now() - started);
    if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
    setSpinning(false);
  };

  const feed = useMemo(() => {
    const forms = new Map(listForms().map((f) => [f.id, f]));
    return listSubmissionIndex()
      .slice(0, FEED_LIMIT)
      .map((sub) => {
        const form = forms.get(sub.formId) ?? getForm(sub.formId);
        const questions = (form?.schema.questions ?? []).filter(
          (q) => q.type !== 'welcome' && q.type !== 'thanks' && q.type !== 'statement',
        );
        // Recent rows arrive with answers; anything older reads "New response".
        const answers = getSubmission(sub.id)?.answers as Record<string, unknown> | undefined;
        const lead = answers ? leadPreview(questions, answers) : { primary: '—' };
        return {
          id: sub.id,
          formId: sub.formId,
          formName: form?.name ?? 'Untitled form',
          preview: lead.primary === '—' ? 'New response' : lead.primary,
          when: formatRelativeAge(sub.receivedAt),
          whenFull: formatSubmittedAt(sub.receivedAt),
          unread: unread.has(sub.id),
        };
      });
    // `tick` is deliberate: it re-runs this so the relative ages ("2m") stay fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, tick]);

  // Unread ids live in localStorage per browser, not per account — count only
  // the ones this account actually has, so another account's 9+ never shows.
  const unreadIds = useMemo(
    () =>
      listSubmissionIndex()
        .filter((s) => unread.has(s.id))
        .map((s) => s.id),
    // `tick` re-runs this after each ingest, when the index may have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unread, tick],
  );
  const unreadCount = unreadIds.length;

  const markAllRead = () => markRead(unreadIds);

  const openItem = (id: string, formId: string) => {
    markRead([id]);
    setOpen(false);
    navigate(`/forms/${formId}/submissions`);
  };

  const mode = readSlateMode();
  const uiTheme = detectAdminUiTheme();

  return (
    <>
      {spinning && typeof document !== 'undefined'
        ? createPortal(<LoadingScreen label="Refreshing" />, document.body)
        : null}
      <button
        type="button"
        className="slate-btn slate-btn--icon slate-refresh-btn"
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
        className={`slate-btn slate-btn--icon slate-inbox-btn${open ? ' slate-inbox-btn--open' : ''}${
          ring > 0 ? ' slate-inbox-btn--ring' : ''
        }`}
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        data-slate-sound="open"
      >
        <IconBell key={`bell-${ring}`} swing={ring > 0} />
        {unreadCount > 0 ? (
          <span key={`badge-${ring}`} className="slate-inbox-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-slate-forms=""
              data-theme-name="slate"
              data-admin-ui={uiTheme}
              data-theme={mode}
            >
              <div
                ref={panelRef}
                className="slate-inbox"
                role="dialog"
                aria-label="Notifications"
                style={{ top: anchor.top, right: anchor.right }}
              >
                <header className="slate-inbox-header">
                  <h2 className="slate-inbox-title">
                    Notifications
                    {unreadCount > 0 ? (
                      <span className="slate-inbox-count">{unreadCount} new</span>
                    ) : null}
                  </h2>
                  {unreadCount > 0 ? (
                    <button
                      type="button"
                      className="slate-link"
                      data-slate-sound="none"
                      onClick={markAllRead}
                    >
                      Mark all read
                    </button>
                  ) : null}
                </header>
                {feed.length === 0 ? (
                  <p className="slate-inbox-empty">
                    Responses from your forms show up here as they come in.
                  </p>
                ) : (
                  <ul className="slate-inbox-list">
                    {feed.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`slate-inbox-item${row.unread ? ' slate-inbox-item--unread' : ''}${
                            // Read at render, not in the memo: opening the panel
                            // later must not replay an old arrival.
                            isArrival(row.id) ? ' is-arrived' : ''
                          }`}
                          data-slate-sound="none"
                          onClick={() => openItem(row.id, row.formId)}
                          aria-label={`${row.preview}, ${row.formName}, ${row.whenFull}${row.unread ? ', unread' : ''}`}
                        >
                          <span className="slate-inbox-dot" aria-hidden />
                          <span className="slate-inbox-text">
                            {row.preview}
                            <span className="slate-inbox-form"> · {row.formName}</span>
                          </span>
                          <span className="slate-inbox-when" title={row.whenFull}>
                            {row.when}
                          </span>
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
