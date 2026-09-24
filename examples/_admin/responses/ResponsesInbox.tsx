/**
 * Inbox split view (ADR-055), ported from the approved prototype "01 Inbox
 * split view". Desktop: one bordered panel with the day-grouped list on the
 * left (search, All / Unread, keyboard: j k Enter Esc / u) and the open
 * response on the right; with nothing open, the right side lists what is
 * still unread. Phones: the list scrolls with the page and a tapped row
 * opens full width. Trash mode reuses the layout with Restore and Delete
 * forever. Respondent text renders as React text only.
 */

'use client';

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { Question } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import type { InboxProps } from './types.js';
import {
  answerPreview,
  answerValues,
  dayGroups,
  firstName,
  formatDuration,
  fullDate,
  hasFiles,
  matchesSearch,
  nameQuestion,
  namedRespondent,
  relativeAge,
  respondentEmail,
  respondentName,
  responseNumbers,
  tableColumns,
  unreadIds,
} from './model.js';
import { shouldIgnoreShortcut, useFinePointer, useMarkAllRead, useNow, usePhone } from './hooks.js';
import { ResponseAnswers } from './ResponseAnswers.js';
import { ResponseActions } from './ResponseActions.js';
import {
  IconArrowLeft,
  IconCheck,
  IconCheckAll,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconClip,
  IconRestore,
  IconSearch,
  IconTrash,
  IconX,
} from './icons.js';
import './responses.css';
import './inbox.css';

/** Rows rendered per step; more load as the list scrolls (or j/k reach them). */
const PAGE = 150;
/** Unread cards shown in the reader while nothing is open. */
const DIGEST_MAX = 4;
/** Other responses from the same address listed under a response. */
const ALSO_MAX = 5;
const SNIP_MAX = 160;
/** A search hit further in than this re-centres the row preview on it. */
const SNIP_LEAD = 28;
const EMPTY: ReadonlySet<string> = new Set();

type Filter = 'all' | 'unread';

type RowData = {
  sub: StoredSubmission;
  name: string;
  /** First choice column's answer ("Repair"). */
  need: string;
  /** Text preview — the long answer, or wherever the search hit. */
  snip: string;
  files: boolean;
};

/* ---------- text helpers ---------- */

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function searchTerms(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Wraps each search hit in <mark>. Builds React text nodes, never markup. */
function highlight(text: string, terms: ReadonlyArray<string>): ReactNode {
  if (terms.length === 0 || !text) return text;
  const lower = text.toLowerCase();
  // Some characters change length when lower-cased; skip marks rather than misplace them.
  if (lower.length !== text.length) return text;
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length && out.length < 40) {
    let at = -1;
    let len = 0;
    for (const t of terms) {
      const j = lower.indexOf(t, i);
      if (j !== -1 && (at === -1 || j < at || (j === at && t.length > len))) {
        at = j;
        len = t.length;
      }
    }
    if (at === -1) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={at} className="rsp-mark">
        {text.slice(at, at + len)}
      </mark>,
    );
    i = at + len;
  }
  if (out.length === 0) return text;
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/** "Looking at … plunge pool" → "…plunge pool" when the hit sits far in. */
function centerOn(text: string, at: number): string {
  if (at <= SNIP_LEAD) return text;
  const cut = text.lastIndexOf(' ', at - 12);
  return `…${text.slice(cut === -1 ? at : cut + 1)}`;
}

/** "2 minutes ago", "yesterday", "12 days ago". */
function ageLong(iso: string | undefined, now: Date): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((now.getTime() - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return min === 1 ? '1 minute ago' : `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const then = new Date(t);
  const days = Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
      86_400_000,
  );
  if (days <= 1) return 'yesterday';
  return `${days} days ago`;
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function ordinal(n: number): string {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function fileCount(sub: StoredSubmission, questions: ReadonlyArray<Question>): number {
  let n = 0;
  for (const q of questions) {
    if (q.type === 'file_upload') n += answerValues(sub.answers[q.id]).length;
  }
  return n;
}

function buildRow(
  sub: StoredSubmission,
  questions: ReadonlyArray<Question>,
  need: Question | null,
  text: Question | null,
  nameQ: Question | null,
  terms: ReadonlyArray<string>,
  name: string,
): RowData {
  const needText = need ? answerPreview(sub, need, 48) : '';
  const base = text ? answerPreview(sub, text, 2000) : '';
  let snip = base;
  const t = terms[0];
  if (t) {
    const at = base.toLowerCase().indexOf(t);
    if (at !== -1) {
      snip = centerOn(base, at);
    } else if (!name.toLowerCase().includes(t) && !needText.toLowerCase().includes(t)) {
      // The hit is in another answer — show that one instead.
      for (const q of questions) {
        if (q === text || q === need || q === nameQ || q.type === 'file_upload') continue;
        const v = answerPreview(sub, q, 2000);
        const j = v.toLowerCase().indexOf(t);
        if (j !== -1) {
          snip = centerOn(v, j);
          break;
        }
      }
    }
  }
  if (!snip && !needText) {
    const email = respondentEmail(questions, sub.answers);
    if (email && email.toLowerCase() !== name.toLowerCase()) snip = email;
  }
  return {
    sub,
    name,
    need: needText,
    snip: clip(oneLine(snip), SNIP_MAX),
    files: hasFiles(sub, questions),
  };
}

/* ---------- list row ---------- */

type RowProps = {
  row: RowData;
  age: string;
  unread: boolean;
  selected: boolean;
  tabbable: boolean;
  terms: ReadonlyArray<string>;
  onOpen(id: string): void;
};

const InboxRow = memo(function InboxRow({
  row,
  age,
  unread,
  selected,
  tabbable,
  terms,
  onOpen,
}: RowProps) {
  const { sub, name, need, snip, files } = row;
  return (
    <li>
      <button
        type="button"
        className={`rsp-ib-row${unread ? ' rsp-ib-row--unread' : ''}${selected ? ' rsp-ib-row--sel' : ''}`}
        data-focus={`row:${sub.id}`}
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(sub.id)}
      >
        <span className="rsp-ib-dot" aria-hidden="true" />
        <span className="rsp-ib-row-main">
          <span className="rsp-ib-row-top">
            {unread ? <span className="rsp-sr">Unread. </span> : null}
            <span className="rsp-ib-name" dir="auto">
              {highlight(name, terms)}
            </span>
            <time className="rsp-ib-time" dateTime={sub.receivedAt}>
              {age}
            </time>
          </span>
          {need || snip || files ? (
            <span className="rsp-ib-row-sub">
              {need ? (
                <span className="rsp-ib-need" dir="auto">
                  {highlight(need, terms)}
                </span>
              ) : null}
              {need && snip ? (
                <span className="rsp-ib-sep" aria-hidden="true">
                  ·
                </span>
              ) : null}
              {snip ? (
                <span className="rsp-ib-snip" dir="auto">
                  {highlight(snip, terms)}
                </span>
              ) : null}
              {files ? (
                <>
                  <IconClip className="rsp-ib-clip" />
                  <span className="rsp-sr"> Has files.</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
});

/* ---------- copy email ---------- */

function CopyEmail({ email, onFallback }: { email: string; onFallback(): void }) {
  const [state, setState] = useState<'idle' | 'done' | 'manual'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 1600);
    return () => window.clearTimeout(t);
  }, [state]);

  const copy = () => {
    const fail = () => {
      onFallback();
      setState('manual');
    };
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) return fail();
      clipboard.writeText(email).then(() => setState('done'), fail);
    } catch {
      fail();
    }
  };

  return (
    <button
      type="button"
      className={`rsp-ib-copy${state === 'done' ? ' rsp-ib-copy--done' : ''}`}
      onClick={copy}
      aria-label={state === 'done' ? 'Email address copied' : 'Copy email address'}
    >
      {state === 'done' ? <IconCheck /> : null}
      <span aria-live="polite">
        {state === 'done' ? 'Copied' : state === 'manual' ? 'Selected' : 'Copy'}
      </span>
    </button>
  );
}

/* ---------- the view ---------- */

export function ResponsesInbox({
  formName,
  questions,
  subs,
  unread,
  mode,
  onMarkRead,
  onMarkUnread,
  onTrash,
  onRestore,
  onDeleteForever,
  onRestoreAll,
  onEmptyTrash,
}: InboxProps) {
  const trash = mode === 'trash';
  const phone = usePhone();
  const finePointer = useFinePointer();
  const now = useNow();
  const markAll = useMarkAllRead(onMarkRead, onMarkUnread);
  const titleId = useId();

  const [openId, setOpenId] = useState<string | null>(null);
  /** Last opened response — j/k carry on from here after closing. */
  const [lastId, setLastId] = useState<string | null>(null);
  const [filter, setFilterState] = useState<Filter>('all');
  const [query, setQueryState] = useState('');
  const deferredQuery = useDeferredValue(query);
  /** Rows kept in the Unread filter after being opened (and so read). */
  const [keep, setKeep] = useState<ReadonlySet<string>>(EMPTY);
  const [limit, setLimit] = useState(PAGE);
  /** Last read / unread change, for the polite live region. */
  const [said, setSaid] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLSpanElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  /** `row:<id>`, `title` or `search` — focused after the next render. */
  const pendingFocus = useRef<string | null>(null);
  const pendingReveal = useRef(false);
  /** Phones: page scroll of the list, restored when the reader closes. */
  const listScrollY = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const shownId = useRef<string | null>(null);
  const order = useRef<string[]>([]);

  /* ----- derived ----- */

  const numbers = useMemo(() => responseNumbers(subs), [subs]);
  const columns = useMemo(() => tableColumns(questions), [questions]);
  const nameQ = useMemo(() => nameQuestion(questions), [questions]);
  const byId = useMemo(() => new Map(subs.map((s) => [s.id, s])), [subs]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subs) m.set(s.id, respondentName(questions, s.answers, numbers.get(s.id) ?? 0));
    return m;
  }, [subs, questions, numbers]);
  /** Lower-cased email → response ids, newest first. */
  const byEmail = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of subs) {
      const email = respondentEmail(questions, s.answers)?.toLowerCase();
      if (!email) continue;
      const list = m.get(email);
      if (list) list.push(s.id);
      else m.set(email, [s.id]);
    }
    return m;
  }, [subs, questions]);

  const unreadHere = useMemo(() => (trash ? [] : unreadIds(subs, unread)), [trash, subs, unread]);
  const unreadFilter = !trash && filter === 'unread' ? unread : null;
  const terms = useMemo(() => searchTerms(deferredQuery), [deferredQuery]);
  const visible = useMemo(
    () =>
      subs.filter(
        (s) =>
          (!unreadFilter || unreadFilter.has(s.id) || keep.has(s.id)) &&
          matchesSearch(s, questions, deferredQuery),
      ),
    [subs, questions, deferredQuery, unreadFilter, keep],
  );
  const indexOf = useMemo(() => new Map(visible.map((s, i) => [s.id, i])), [visible]);
  const groups = useMemo(() => dayGroups(visible, now), [visible, now]);
  const rowOf = useMemo(() => {
    const cache = new WeakMap<StoredSubmission, RowData>();
    const need = columns.choices[0] ?? null;
    return (s: StoredSubmission): RowData => {
      let row = cache.get(s);
      if (!row) {
        row = buildRow(s, questions, need, columns.text, nameQ, terms, names.get(s.id) ?? '');
        cache.set(s, row);
      }
      return row;
    };
  }, [questions, columns, nameQ, terms, names]);

  /** Ages only change with the clock; formatting dates per row per keypress adds up. */
  const ageOf = useMemo(() => {
    const cache = new Map<string, string>();
    return (iso: string): string => {
      let age = cache.get(iso);
      if (age === undefined) {
        age = relativeAge(iso, now);
        cache.set(iso, age);
      }
      return age;
    };
  }, [now]);

  const renderedCount = Math.min(limit, visible.length);
  const hasMore = visible.length > limit;
  const openSub = openId ? byId.get(openId) : undefined;
  const openIdx = openId ? (indexOf.get(openId) ?? -1) : -1;
  const isRendered = (id: string | null): id is string => {
    const i = id ? indexOf.get(id) : undefined;
    return i !== undefined && i < renderedCount;
  };
  const anchorId = isRendered(openId)
    ? openId
    : isRendered(lastId)
      ? lastId
      : (visible[0]?.id ?? null);
  const listShown = !phone || !openSub;
  const readerShown = !phone || Boolean(openSub);

  /* ----- actions ----- */

  const open = useCallback(
    (id: string, focus?: 'row' | 'title') => {
      if (!byId.has(id)) return;
      if (phone && !openId) listScrollY.current = window.scrollY;
      setOpenId(id);
      setLastId(id);
      if (!trash && filter === 'unread') setKeep((k) => (k.has(id) ? k : new Set(k).add(id)));
      if (!trash && unread.has(id)) onMarkRead([id]);
      const i = indexOf.get(id);
      if (i !== undefined && i >= limit) setLimit(Math.ceil((i + 1) / PAGE) * PAGE);
      pendingReveal.current = true;
      // Phones swap the list for the reader: land on the name. Moving within
      // an open reader (↑ ↓) leaves focus where it is.
      pendingFocus.current = phone
        ? openId
          ? null
          : 'title'
        : focus === 'row'
          ? `row:${id}`
          : (focus ?? null);
    },
    [byId, phone, openId, trash, filter, unread, onMarkRead, indexOf, limit],
  );

  const close = useCallback(() => {
    if (!openId) return;
    pendingFocus.current = `row:${openId}`;
    if (phone) pendingScroll.current = listScrollY.current;
    setOpenId(null);
  }, [openId, phone]);

  /** j / k / ↑ ↓: open the next or previous response in the list. */
  const move = useCallback(
    (delta: 1 | -1, focusRow: boolean) => {
      if (visible.length === 0) return;
      const clamp = (i: number) => Math.max(0, Math.min(visible.length - 1, i));
      const lastIdx = !openId && lastId ? (indexOf.get(lastId) ?? -1) : -1;
      let next: StoredSubmission | undefined;
      if (lastIdx !== -1) {
        // Closed or just marked: carry on from where the owner left off.
        next = visible[clamp(lastIdx + delta)];
      } else if (openIdx === -1) {
        next = (!openId && !trash && visible.find((s) => unread.has(s.id))) || visible[0];
      } else {
        next = visible[clamp(openIdx + delta)];
        if (next?.id === openId) return;
      }
      if (next) open(next.id, focusRow ? 'row' : undefined);
    },
    [visible, openId, lastId, indexOf, openIdx, trash, unread, open],
  );

  /** The reader's read toggle (its button or u), announced for screen readers. */
  const setRead = useCallback(
    (id: string, read: boolean) => {
      if (read) onMarkRead([id]);
      else onMarkUnread(id);
      setSaid(`${names.get(id) ?? 'Response'} marked as ${read ? 'read' : 'unread'}.`);
    },
    [names, onMarkRead, onMarkUnread],
  );
  const toggleRead = useCallback((id: string) => setRead(id, unread.has(id)), [setRead, unread]);
  const onActionRead = useCallback(
    (ids: string[]) => ids.forEach((id) => setRead(id, true)),
    [setRead],
  );
  const onActionUnread = useCallback((id: string) => setRead(id, false), [setRead]);

  const focusSearch = useCallback(() => {
    if (phone && openId) {
      // Back to the list, scrolled to the search box rather than the old spot.
      setOpenId(null);
      pendingFocus.current = 'search';
      return;
    }
    searchRef.current?.focus({ preventScroll: true });
    searchRef.current?.select();
  }, [phone, openId]);

  const setFilter = (next: Filter) => {
    if (next === filter) return;
    setFilterState(next);
    setKeep(EMPTY);
    setLimit(PAGE);
    if (rowsRef.current && !phone) rowsRef.current.scrollTop = 0;
  };

  const setQuery = (next: string) => {
    setQueryState(next);
    setLimit(PAGE);
    if (rowsRef.current && !phone) rowsRef.current.scrollTop = 0;
  };

  const clearSearch = () => {
    setQuery('');
    searchRef.current?.focus({ preventScroll: true });
  };

  const markAllRead = () => {
    if (unreadHere.length === 0) return;
    markAll(unreadHere);
    setKeep(EMPTY);
  };

  // Rows re-render only when their own props change; route clicks through a ref.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const onRowOpen = useCallback((id: string) => openRef.current(id, 'row'), []);

  /* ----- effects ----- */

  // The open response left the list (trashed, restored, deleted): show its
  // neighbour — the next older one, else the next newer — or close.
  useLayoutEffect(() => {
    if (openId && !byId.has(openId)) {
      const old = order.current;
      const at = old.indexOf(openId);
      let next: string | null = null;
      if (at !== -1) {
        for (let i = at + 1; i < old.length && !next; i++) if (indexOf.has(old[i]!)) next = old[i]!;
        for (let i = at - 1; i >= 0 && !next; i--) if (indexOf.has(old[i]!)) next = old[i]!;
      }
      if (next) open(next);
      else {
        setOpenId(null);
        if (phone) pendingScroll.current = listScrollY.current;
      }
    }
    order.current = visible.map((s) => s.id);
  }, [openId, byId, indexOf, visible, open, phone]);

  // After each render: restore list scroll (phones), reset the reader to the
  // top for a new response, reveal the open row, and apply pending focus.
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && listShown) {
      window.scrollTo(0, pendingScroll.current);
      pendingScroll.current = null;
    }
    if (shownId.current !== (openSub?.id ?? null)) {
      shownId.current = openSub?.id ?? null;
      if (readerScrollRef.current) readerScrollRef.current.scrollTop = 0;
      if (phone && openSub) readerRef.current?.scrollIntoView?.({ block: 'start' });
    }
    if (pendingReveal.current && openId && !phone) {
      pendingReveal.current = false;
      findFocusable(rootRef.current, `row:${openId}`)?.scrollIntoView?.({ block: 'nearest' });
    }
    const key = pendingFocus.current;
    if (key) {
      pendingFocus.current = null;
      if (key === 'search') {
        searchRef.current?.focus();
        searchRef.current?.select();
      } else {
        const el =
          key === 'title'
            ? rootRef.current?.querySelector<HTMLElement>('.rsp-ib-title')
            : (findFocusable(rootRef.current, key) ?? rowsRef.current);
        el?.focus({ preventScroll: true });
      }
    }
  });

  // Load more rows as the end of the list comes near.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || !listShown || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE);
      },
      { root: phone ? null : rowsRef.current, rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, limit, listShown, phone]);

  // Single-key shortcuts. The search box handles its own keys below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || e.target === searchRef.current || shouldIgnoreShortcut(e)) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inList =
        !!target &&
        (target === root ||
          target === rowsRef.current ||
          target.classList.contains('rsp-ib-row') ||
          target.classList.contains('rsp-ib-card'));
      const onPage = !target || target === document.body || target === root;
      switch (e.key) {
        case 'j':
        case 'k':
          e.preventDefault();
          move(e.key === 'j' ? 1 : -1, inList);
          return;
        case 'ArrowDown':
        case 'ArrowUp':
          if (!inList) return;
          e.preventDefault();
          move(e.key === 'ArrowDown' ? 1 : -1, true);
          return;
        case 'Enter':
          if (!onPage || openId || !anchorId) return;
          e.preventDefault();
          open(anchorId, 'row');
          return;
        case '/':
          e.preventDefault();
          focusSearch();
          return;
        case 'u':
        case 'U':
          if (!openId || trash) return;
          e.preventDefault();
          toggleRead(openId);
          return;
        case 'Escape':
          if (!openId) return;
          e.preventDefault();
          close();
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move, open, close, focusSearch, toggleRead, openId, anchorId, trash]);

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1, false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Phones: the keyboard's Search key just puts the keyboard away.
      if (phone) return e.currentTarget.blur();
      const target = openId && indexOf.has(openId) ? openId : visible[0]?.id;
      if (target) open(target, 'row');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else if (anchorId) {
        pendingFocus.current = `row:${anchorId}`;
        findFocusable(rootRef.current, `row:${anchorId}`)?.focus({ preventScroll: true });
      }
    }
  };

  /* ----- list ----- */

  // Groups span the whole filtered list so counts are true; rows render up to `limit`.
  const rowGroups: ReactNode[] = [];
  {
    let budget = renderedCount;
    for (const g of groups) {
      if (budget <= 0) break;
      const items = g.items.slice(0, budget);
      budget -= items.length;
      rowGroups.push(
        <li key={g.key} className="rsp-ib-group">
          <div className="rsp-ib-grp" aria-hidden="true">
            <span>{g.label}</span>
            <span className="rsp-ib-grp-n">{g.items.length}</span>
          </div>
          <ul
            className="rsp-ib-group-rows"
            aria-label={`${g.label}, ${plural(g.items.length, 'response', 'responses')}`}
          >
            {items.map((s) => (
              <InboxRow
                key={s.id}
                row={rowOf(s)}
                age={ageOf(s.receivedAt)}
                unread={!trash && unread.has(s.id)}
                selected={s.id === openId}
                tabbable={s.id === anchorId}
                terms={terms}
                onOpen={onRowOpen}
              />
            ))}
          </ul>
        </li>,
      );
    }
  }

  const trimmedQuery = query.trim();
  let listEmpty: ReactNode = null;
  if (visible.length === 0) {
    listEmpty = trimmedQuery ? (
      <div className="rsp-empty rsp-ib-empty">
        <p className="rsp-empty-title">No responses match “{clip(trimmedQuery, 60)}”</p>
        <p className="rsp-empty-copy">
          Search looks at names, emails and every answer
          {!trash && filter === 'unread' ? ' in unread responses' : ''}.
        </p>
        <button type="button" className="rsp-btn" onClick={clearSearch}>
          Clear search
        </button>
      </div>
    ) : !trash && filter === 'unread' ? (
      <div className="rsp-empty rsp-ib-empty">
        <p className="rsp-empty-title">You’re all caught up</p>
        <p className="rsp-empty-copy">No unread responses.</p>
        <button type="button" className="rsp-btn" onClick={() => setFilter('all')}>
          Show all responses
        </button>
      </div>
    ) : null;
  }

  const live =
    trimmedQuery || (!trash && filter === 'unread')
      ? trimmedQuery
        ? `${plural(visible.length, 'response matches', 'responses match')} “${clip(trimmedQuery, 60)}”`
        : plural(visible.length, 'unread response', 'unread responses')
      : '';

  const list = listShown ? (
    <div className="rsp-ib-list" role="region" aria-label={trash ? 'Trash list' : 'Response list'}>
      <div className="rsp-ib-tools">
        <div className="rsp-ib-search" role="search">
          <IconSearch />
          <input
            ref={searchRef}
            className="rsp-ib-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={phone ? 'Search responses' : 'Search name, email, answers'}
            aria-label={trash ? 'Search trash' : 'Search responses'}
            aria-keyshortcuts="/"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query ? (
            <button
              type="button"
              className="rsp-ib-search-clear"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <IconX />
            </button>
          ) : (
            <kbd className="rsp-kbd rsp-kbd--hint rsp-ib-search-hint" aria-hidden="true">
              /
            </kbd>
          )}
        </div>
        <div className="rsp-ib-filterbar">
          {trash ? (
            <>
              <button type="button" className="rsp-textbtn rsp-ib-edge" onClick={onRestoreAll}>
                <IconRestore />
                Restore all
              </button>
              <button
                type="button"
                className="rsp-textbtn rsp-textbtn--danger"
                onClick={onEmptyTrash}
              >
                <IconTrash />
                Empty trash
              </button>
            </>
          ) : (
            <>
              <div className="rsp-seg" role="group" aria-label="Show">
                <button
                  type="button"
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
                  All <span className="rsp-seg-n">{subs.length}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={filter === 'unread'}
                  onClick={() => setFilter('unread')}
                >
                  <span
                    className={`rsp-seg-dot${unreadHere.length === 0 ? ' rsp-seg-dot--off' : ''}`}
                    aria-hidden="true"
                  />
                  Unread <span className="rsp-seg-n">{unreadHere.length}</span>
                </button>
              </div>
              <button
                type="button"
                className="rsp-textbtn"
                onClick={markAllRead}
                aria-disabled={unreadHere.length === 0}
                title={
                  unreadHere.length === 0
                    ? 'Nothing unread'
                    : `Mark ${plural(unreadHere.length, 'response', 'responses')} as read`
                }
              >
                <IconCheckAll />
                Mark all read
              </button>
            </>
          )}
        </div>
      </div>
      <p className="rsp-sr" role="status" aria-live="polite">
        {live}
      </p>
      <div ref={rowsRef} className="rsp-ib-rows" tabIndex={-1}>
        {listEmpty ?? (
          <ul
            className="rsp-ib-groups"
            aria-label={trash ? 'Deleted responses, newest first' : 'Responses, newest first'}
          >
            {rowGroups}
          </ul>
        )}
        {hasMore ? (
          <div ref={sentinelRef} className="rsp-ib-more">
            <button type="button" className="rsp-textbtn" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, visible.length - limit)} more
            </button>
          </div>
        ) : null}
      </div>
      {finePointer && !phone ? (
        <div className="rsp-ib-legend rsp-desktop-only" aria-hidden="true">
          <span>
            <kbd className="rsp-kbd">j</kbd>
            <kbd className="rsp-kbd">k</kbd> move
          </span>
          <span>
            <kbd className="rsp-kbd">/</kbd> search
          </span>
          {trash ? null : (
            <span>
              <kbd className="rsp-kbd">u</kbd> mark unread
            </span>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  /* ----- reader ----- */

  let reader: ReactNode = null;
  if (readerShown && openSub) {
    const name = names.get(openSub.id) ?? '';
    const anonymous = namedRespondent(questions, openSub.answers) === null;
    const email = respondentEmail(questions, openSub.answers);
    const hist = email ? (byEmail.get(email.toLowerCase()) ?? [openSub.id]) : [openSub.id];
    const nth = hist.length - hist.indexOf(openSub.id);
    const others =
      trash || hist.length < 2
        ? []
        : hist
            .filter((id) => id !== openSub.id)
            .slice(0, ALSO_MAX)
            .map((id) => byId.get(id))
            .filter((s): s is StoredSubmission => Boolean(s));
    const pos = openIdx === -1 ? 'Not in this view' : `${openIdx + 1} of ${visible.length}`;
    // aria-disabled, not disabled: a button that disables itself under the
    // pointer or keyboard would drop focus to the page.
    const noNewer = openIdx <= 0;
    const noOlder = openIdx === -1 || openIdx >= visible.length - 1;
    const actions = (
      <ResponseActions
        sub={openSub}
        questions={questions}
        formName={formName}
        mode={mode}
        isUnread={!trash && unread.has(openSub.id)}
        variant="toolbar"
        onMarkRead={onActionRead}
        onMarkUnread={onActionUnread}
        onTrash={onTrash}
        onRestore={onRestore}
        onDeleteForever={onDeleteForever}
        className={phone ? 'rsp-ib-phone-actions' : undefined}
      />
    );
    const nav = (
      <div className="rsp-ib-nav">
        <button
          type="button"
          className="rsp-iconbtn"
          onClick={() => (noNewer ? undefined : move(-1, false))}
          aria-disabled={noNewer}
          aria-label="Newer response"
          aria-keyshortcuts="k"
          title="Newer  k"
        >
          <IconChevronUp />
        </button>
        <button
          type="button"
          className="rsp-iconbtn"
          onClick={() => (noOlder ? undefined : move(1, false))}
          aria-disabled={noOlder}
          aria-label="Older response"
          aria-keyshortcuts="j"
          title="Older  j"
        >
          <IconChevronDown />
        </button>
        {phone ? null : <span className="rsp-ib-pos">{pos}</span>}
      </div>
    );

    reader = (
      <section
        ref={readerRef}
        className="rsp-ib-read"
        aria-labelledby={titleId}
        data-open={openSub.id}
      >
        <div className="rsp-ib-bar">
          {phone ? (
            <>
              <button type="button" className="rsp-textbtn rsp-ib-back" onClick={close}>
                <IconArrowLeft />
                {trash ? 'Trash' : 'All responses'}
              </button>
              {nav}
            </>
          ) : (
            <>
              {nav}
              <div className="rsp-ib-bar-actions">
                {actions}
                <button
                  type="button"
                  className="rsp-iconbtn rsp-iconbtn--quiet"
                  onClick={close}
                  aria-label="Close response"
                  aria-keyshortcuts="Escape"
                  title="Close  Esc"
                >
                  <IconX />
                </button>
              </div>
            </>
          )}
        </div>
        <div
          ref={readerScrollRef}
          className="rsp-ib-scroll"
          tabIndex={phone ? undefined : 0}
          aria-labelledby={phone ? undefined : titleId}
          role={phone ? undefined : 'group'}
        >
          <article className="rsp-ib-doc">
            <p className="rsp-eyebrow">
              {/* Trash numbers would only count the trash; leave them out.
                  Anonymous responses are already titled "Response #n". */}
              {trash
                ? 'In trash'
                : anonymous
                  ? 'Anonymous'
                  : `Response #${numbers.get(openSub.id)}`}
            </p>
            <h2 id={titleId} className="rsp-ib-title" tabIndex={-1} dir="auto">
              {highlight(name, terms)}
            </h2>
            {email ? (
              <p className="rsp-ib-contact">
                <span ref={emailRef} className="rsp-ib-email slate-selectable">
                  {highlight(email, terms)}
                </span>
                <CopyEmail
                  key={openSub.id}
                  email={email}
                  onFallback={() => selectText(emailRef.current)}
                />
              </p>
            ) : null}
            <dl className="rsp-ib-facts">
              <div>
                <dt>Received</dt>
                <dd title={capitalize(ageLong(openSub.receivedAt, now))}>
                  {fullDate(openSub.receivedAt, now)}
                </dd>
              </div>
              {trash ? (
                <div>
                  <dt>Deleted</dt>
                  <dd>{capitalize(ageLong(openSub.deletedAt, now)) || '—'}</dd>
                </div>
              ) : null}
              <div>
                <dt>Time to complete</dt>
                <dd>{formatDuration(openSub.meta?.durationMs)}</dd>
              </div>
              {!trash && email ? (
                <div>
                  <dt>From this person</dt>
                  <dd>
                    {hist.length > 1 ? (
                      <>
                        Returning{' '}
                        <span className="rsp-ib-fact-sub">
                          · {ordinal(nth)} of {hist.length}
                        </span>
                      </>
                    ) : (
                      'First response'
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            {phone ? actions : null}
            <ResponseAnswers
              questions={questions}
              answers={openSub.answers}
              layout="stack"
              className="rsp-ib-answers"
            />
            {others.length > 0 ? (
              <section className="rsp-ib-also" aria-label={`Other responses from ${name}`}>
                <p className="rsp-eyebrow">Also from {firstName(name)}</p>
                {others.map((o) => {
                  const row = rowOf(o);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className="rsp-ib-also-row"
                      onClick={() => open(o.id, 'title')}
                    >
                      <time dateTime={o.receivedAt}>{relativeAge(o.receivedAt, now)}</time>
                      <span className="rsp-ib-also-need" dir="auto">
                        {row.need || `Response #${numbers.get(o.id)}`}
                      </span>
                      <span className="rsp-ib-also-snip" dir="auto">
                        {row.snip}
                      </span>
                      <IconChevronRight />
                    </button>
                  );
                })}
              </section>
            ) : null}
          </article>
        </div>
      </section>
    );
  } else if (readerShown) {
    reader = (
      <section className="rsp-ib-read" aria-labelledby={titleId}>
        <div className="rsp-ib-scroll">
          <Digest
            titleId={titleId}
            trash={trash}
            subs={subs}
            unreadHere={unreadHere}
            names={names}
            rowOf={rowOf}
            questions={questions}
            now={now}
            showJ={finePointer && visible.length > 0}
            onOpen={(id) => open(id, 'row')}
          />
        </div>
      </section>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`rsp-ib${trash ? ' rsp-ib--trash' : ''}${openSub ? ' rsp-ib--open' : ''}`}
      tabIndex={-1}
    >
      {list}
      {reader}
      <p className="rsp-sr" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}

/* ---------- nothing open ---------- */

type DigestProps = {
  titleId: string;
  trash: boolean;
  subs: ReadonlyArray<StoredSubmission>;
  unreadHere: ReadonlyArray<string>;
  names: ReadonlyMap<string, string>;
  rowOf(s: StoredSubmission): RowData;
  questions: ReadonlyArray<Question>;
  now: Date;
  showJ: boolean;
  onOpen(id: string): void;
};

function Digest({
  titleId,
  trash,
  subs,
  unreadHere,
  names,
  rowOf,
  questions,
  now,
  showJ,
  onOpen,
}: DigestProps) {
  const jHint = showJ ? (
    <span className="rsp-ib-hint rsp-desktop-only">
      or press <kbd className="rsp-kbd">j</kbd>
    </span>
  ) : null;
  const latest = subs[0];

  if (trash) {
    return (
      <div className="rsp-ib-digest">
        <p className="rsp-eyebrow">Trash</p>
        <h2 id={titleId} className="rsp-ib-title">
          {plural(subs.length, 'deleted response', 'deleted responses')}
        </h2>
        <p className="rsp-ib-lede">
          They stay here until you empty trash. Open one to restore it or delete it forever.
        </p>
        {latest ? (
          <div className="rsp-ib-digest-actions">
            <button type="button" className="rsp-btn" onClick={() => onOpen(latest.id)}>
              Open newest
            </button>
            {jHint}
          </div>
        ) : null}
      </div>
    );
  }

  if (unreadHere.length > 0) {
    const byId = new Map(subs.map((s) => [s.id, s]));
    const cards = unreadHere
      .slice(0, DIGEST_MAX)
      .map((id) => byId.get(id))
      .filter((s): s is StoredSubmission => Boolean(s));
    const newest = cards[0];
    return (
      <div className="rsp-ib-digest">
        <p className="rsp-eyebrow">New since your last visit</p>
        <h2 id={titleId} className="rsp-ib-title">
          {plural(unreadHere.length, 'unread response', 'unread responses')}
        </h2>
        {newest ? (
          <p className="rsp-ib-lede">The newest came in {ageLong(newest.receivedAt, now)}.</p>
        ) : null}
        <ul className="rsp-ib-cards">
          {cards.map((s) => {
            const row = rowOf(s);
            const files = row.files ? fileCount(s, questions) : 0;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="rsp-ib-card"
                  data-focus={`card:${s.id}`}
                  onClick={() => onOpen(s.id)}
                >
                  <span className="rsp-ib-dot" aria-hidden="true" />
                  <span className="rsp-ib-row-main">
                    <span className="rsp-ib-card-top">
                      <span className="rsp-sr">Unread. </span>
                      <span className="rsp-ib-card-name" dir="auto">
                        {names.get(s.id)}
                      </span>
                      {row.need ? (
                        <span className="rsp-ib-card-need" dir="auto">
                          {row.need}
                        </span>
                      ) : null}
                      <time className="rsp-ib-time" dateTime={s.receivedAt}>
                        {relativeAge(s.receivedAt, now)}
                      </time>
                    </span>
                    {row.snip ? (
                      <span className="rsp-ib-card-note" dir="auto">
                        {row.snip}
                      </span>
                    ) : null}
                    {files > 0 ? (
                      <span className="rsp-ib-card-file">
                        <IconClip />
                        {plural(files, 'file', 'files')}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {unreadHere.length > DIGEST_MAX ? (
          <p className="rsp-ib-lede rsp-ib-more-note">
            …and {unreadHere.length - DIGEST_MAX} more in the list.
          </p>
        ) : null}
        {newest ? (
          <div className="rsp-ib-digest-actions">
            <button
              type="button"
              className="rsp-btn rsp-btn--primary"
              onClick={() => onOpen(newest.id)}
            >
              Read newest
            </button>
            {jHint}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rsp-ib-digest">
      <div className="rsp-ib-done" aria-hidden="true">
        <IconCheck />
      </div>
      <p className="rsp-eyebrow">All caught up</p>
      <h2 id={titleId} className="rsp-ib-title">
        Nothing unread
      </h2>
      {latest ? (
        <p className="rsp-ib-lede">
          {plural(subs.length, 'response', 'responses')} in total.{' '}
          {namedRespondent(questions, latest.answers) === null ? (
            <>The latest came in {ageLong(latest.receivedAt, now)}.</>
          ) : (
            <>
              The latest came from <span dir="auto">{names.get(latest.id)}</span>{' '}
              {ageLong(latest.receivedAt, now)}.
            </>
          )}
        </p>
      ) : null}
      {latest ? (
        <div className="rsp-ib-digest-actions">
          <button type="button" className="rsp-btn" onClick={() => onOpen(latest.id)}>
            Open latest
          </button>
          {jHint}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- DOM helpers ---------- */

/** `[data-focus="key"]` without building a selector from response ids. */
function findFocusable(root: HTMLElement | null, key: string): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>('[data-focus]')) {
    if (el.dataset.focus === key) return el;
  }
  return null;
}

/** Copy fallback: select the address so it can be copied by hand. */
function selectText(el: HTMLElement | null) {
  if (!el || typeof window.getSelection !== 'function') return;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    // ignored — the address is still visible and selectable
  }
}
