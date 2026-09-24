/**
 * Summary-first view (ADR-055), ported from the approved "09 Summary
 * first" prototype. Headline numbers and one bar chart per choice or
 * rating question come first; every response sits below in a table whose
 * rows expand in place. Bars and the New / This week tiles filter the
 * table (filters AND together). Each chart re-counts against the other
 * active filters and keeps a faint "ghost" of its full count. Normal page
 * scroll. Respondent text renders as React text only.
 */

'use client';

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Question } from '@/index.js';
import type { StoredSubmission } from '../_submissionStore.js';
import { titleOf } from '../responsesFormat.js';
import type { AnswerFilter, Distribution, Kpis, SummaryProps, TableColumns } from './types.js';
import {
  answerMatchesFilter,
  answerPreview,
  answerText,
  chartableQuestions,
  dayGroupOf,
  dayGroups,
  durationParts,
  formatDuration,
  fullDate,
  hasFiles,
  kpis,
  namedRespondent,
  questionDistribution,
  relativeAge,
  respondentName,
  responseNumbers,
  tableColumns,
  unreadIds,
} from './model.js';
import { isOverlayOpen, useMarkAllRead, useNow, usePhone } from './hooks.js';
import { ResponseAnswers } from './ResponseAnswers.js';
import { ResponseActions } from './ResponseActions.js';
import {
  IconArrowDown,
  IconArrowUp,
  IconCheckAll,
  IconChevronDown,
  IconClip,
  IconFilter,
  IconX,
} from './icons.js';
import './responses.css';
import './summary.css';

/** Rows rendered per "Show more" step. */
export const SUMMARY_PAGE = 100;
/** Choice charts with more options than this fold the rest away. */
const BAR_ROWS = 8;

type Filters = {
  /** At most one per question, in the order they were switched on. */
  answers: ReadonlyArray<AnswerFilter>;
  /** Unread ids when the New tile was pressed, so reading a row keeps it listed. */
  newIds: ReadonlySet<string> | null;
  week: boolean;
};

const NO_FILTERS: Filters = { answers: [], newIds: null, week: false };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function filterCount(f: Filters, skipQuestion?: string): number {
  const answers = f.answers.filter((a) => a.questionId !== skipQuestion).length;
  return answers + (f.newIds ? 1 : 0) + (f.week ? 1 : 0);
}

function matches(
  sub: StoredSubmission,
  f: Filters,
  weekStartMs: number,
  skipQuestion?: string,
): boolean {
  for (const a of f.answers) {
    if (a.questionId !== skipQuestion && !answerMatchesFilter(sub, a)) return false;
  }
  if (f.newIds && !f.newIds.has(sub.id)) return false;
  if (f.week && !(Date.parse(sub.receivedAt) >= weekStartMs)) return false;
  return true;
}

/**
 * Table column tracks: unread dot, respondent, up to two choice columns,
 * the text preview (or a spacer), attachment, received, chevron. `wide`
 * is the prototype's; `mid` shares the space out below ~900px.
 */
function columnTemplates(cols: TableColumns): { wide: string; mid: string } {
  const n = cols.choices.length;
  const wideChoices = ['minmax(96px, 136px)', 'minmax(104px, 152px)'].slice(0, n);
  const midChoices = Array.from({ length: n }, () => 'minmax(72px, 1fr)');
  const hasText = cols.text !== null;
  return {
    wide: [
      '8px',
      hasText ? 'minmax(120px, 168px)' : 'minmax(140px, 240px)',
      ...wideChoices,
      'minmax(0, 1fr)',
      '16px',
      '68px',
      '16px',
    ].join(' '),
    mid: [
      '8px',
      'minmax(100px, 1.3fr)',
      ...midChoices,
      hasText ? 'minmax(0, 1.4fr)' : 'minmax(0, 0.4fr)',
      '16px',
      '60px',
      '16px',
    ].join(' '),
  };
}

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** Bottom edge of the studio's sticky header, in viewport px. */
function studioHeaderBottom(root: HTMLElement): number {
  const header = root.closest('[data-slate-forms]')?.querySelector('.slate-header');
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

/* ---------- KPI tiles ---------- */

function shortDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const Sparkline = memo(function Sparkline({ k }: { k: Kpis }) {
  const max = Math.max(1, ...k.spark);
  const first = k.sparkDays[0];
  const last = k.sparkDays[k.sparkDays.length - 1];
  const range = first && last ? `${shortDay(first)} to ${shortDay(last)}` : '';
  const weekMs = k.weekStart.getTime();
  return (
    <span
      className="rsp-sum-kpi-foot rsp-sum-spark"
      role="img"
      aria-label={`Responses per day, ${range}. This week is highlighted.`}
    >
      {k.spark.map((n, i) => {
        const day = k.sparkDays[i];
        const now = day ? day.getTime() >= weekMs : false;
        const h = n ? `${Math.max(20, Math.round((n / max) * 100))}%` : undefined;
        return (
          <span
            key={i}
            className={`rsp-sum-spark-col${n ? '' : ' is-zero'}${now ? ' is-now' : ''}`}
            title={day ? `${shortDay(day)}: ${plural(n, 'response', 'responses')}` : undefined}
          >
            <i style={h ? { height: h } : undefined} />
          </span>
        );
      })}
    </span>
  );
});

/** "1m 19s" with small unit letters; read aloud as plain "1m 19s". */
function Duration({ ms }: { ms: number | null }) {
  const parts = durationParts(ms);
  if (!parts) return <>—</>;
  return (
    <>
      <span aria-hidden="true">
        {parts.map((p) => (
          <span key={p.unit}>
            {p.value}
            <small>{p.unit}</small>
          </span>
        ))}
      </span>
      <span className="rsp-sr">{formatDuration(ms)}</span>
    </>
  );
}

type KpiProps = {
  k: Kpis;
  newOn: boolean;
  weekOn: boolean;
  onToggleNew(): void;
  onToggleWeek(): void;
};

const KpiTiles = memo(function KpiTiles({ k, newOn, weekOn, onToggleNew, onToggleWeek }: KpiProps) {
  const diff = k.thisWeek - k.lastWeek;
  return (
    <div className="rsp-sum-kpis" role="group" aria-label="Key numbers">
      <div className="rsp-sum-kpi">
        <span className="rsp-sum-kpi-label">Responses</span>
        <span className="rsp-sum-kpi-value">{k.total}</span>
        <Sparkline k={k} />
      </div>
      <button
        type="button"
        className="rsp-sum-kpi rsp-sum-kpi--btn"
        aria-pressed={newOn}
        disabled={k.unread === 0 && !newOn}
        aria-label={`New: ${k.unread} unread. Filter the list to these.`}
        data-fkey="kpi-new"
        onClick={onToggleNew}
      >
        <span className="rsp-sum-kpi-label">
          {k.unread > 0 ? <span className="rsp-dot" aria-hidden="true" /> : null}
          New
        </span>
        <span className="rsp-sum-kpi-value">{k.unread}</span>
        <span className="rsp-sum-kpi-foot">{k.unread > 0 ? 'unread' : 'All caught up'}</span>
        <IconFilter size={14} className="rsp-sum-kpi-icon" />
      </button>
      <button
        type="button"
        className="rsp-sum-kpi rsp-sum-kpi--btn"
        aria-pressed={weekOn}
        disabled={k.thisWeek === 0 && !weekOn}
        aria-label={`This week: ${k.thisWeek}, ${k.lastWeek} last week. Filter the list to this week.`}
        data-fkey="kpi-week"
        onClick={onToggleWeek}
      >
        <span className="rsp-sum-kpi-label">This week</span>
        <span className="rsp-sum-kpi-value">{k.thisWeek}</span>
        <span className="rsp-sum-kpi-foot">
          {diff > 0 ? (
            <>
              <span className="rsp-sum-up">
                <IconArrowUp size={12} />+{diff}
              </span>
              {' '}vs last week
            </>
          ) : diff < 0 ? (
            <>
              <IconArrowDown size={12} />
              {Math.abs(diff)} vs last week
            </>
          ) : (
            'Same as last week'
          )}
        </span>
        <IconFilter size={14} className="rsp-sum-kpi-icon" />
      </button>
      <div className="rsp-sum-kpi">
        <span className="rsp-sum-kpi-label">Median time</span>
        <span className="rsp-sum-kpi-value rsp-sum-kpi-value--dur">
          <Duration ms={k.medianMs} />
        </span>
        <span className="rsp-sum-kpi-foot">
          {k.medianMs === null ? 'No timings yet' : 'to complete'}
        </span>
      </div>
    </div>
  );
});

/* ---------- chart cards ---------- */

type ChartProps = {
  question: Question;
  number: number;
  total: Distribution;
  /** Counts under the other active filters, or null when none apply. */
  crossed: Distribution | null;
  selected: string | null;
  onToggle(questionId: string, value: string): void;
};

function barWidth(count: number, max: number): string {
  return count ? `max(3px, calc((100% - 1px) * ${(count / max).toFixed(4)}))` : '0px';
}

function formatAverage(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const ChartCard = memo(function ChartCard({
  question,
  number,
  total,
  crossed,
  selected,
  onToggle,
}: ChartProps) {
  const [showAll, setShowAll] = useState(false);
  /** Roving tab stop: one per chart; arrow keys move between bars. */
  const [cursor, setCursor] = useState<string | null>(null);
  const titleId = useId();
  const title = titleOf(question);
  const current = crossed ?? total;
  const byValue = useMemo(() => new Map(current.rows.map((r) => [r.value, r])), [current]);
  const foldable = total.kind === 'choice' && total.rows.length > BAR_ROWS + 1;
  const rows =
    foldable && !showAll
      ? total.rows.filter((r, i) => i < BAR_ROWS || r.value === selected)
      : total.rows;
  const hidden = total.rows.length - rows.length;
  const tabStop =
    selected ?? (cursor !== null && rows.some((r) => r.value === cursor) ? cursor : rows[0]?.value);
  const digits = String(Math.max(total.max, 1)).length;
  const style = {
    '--rsp-sum-digits': digits,
    '--rsp-sum-label':
      total.kind === 'numeric' ? `${Math.max(2, ...total.rows.map((r) => r.label.length))}ch` : '',
  } as CSSProperties;

  return (
    <article
      className={`rsp-sum-chart${total.kind === 'numeric' ? ' rsp-sum-chart--numeric' : ''}`}
      aria-labelledby={titleId}
      style={style}
    >
      <header className="rsp-sum-chart-head">
        <h3 className="rsp-sum-chart-title" id={titleId}>
          <span className="rsp-sum-qnum">Q{number}</span>
          <span className="rsp-sum-chart-text" title={title} dir="auto">
            {title}
          </span>
        </h3>
        <span className="rsp-sum-chart-meta">
          {current.average !== null ? (
            <span className="rsp-sum-avg">avg {formatAverage(current.average)}</span>
          ) : null}
          {crossed ? (
            <span>
              <b>{crossed.answered}</b> of {total.answered} match
            </span>
          ) : (
            <span>{plural(total.answered, 'answer', 'answers')}</span>
          )}
        </span>
      </header>
      <div
        className="rsp-sum-bars"
        role="group"
        aria-label={`${title}. Choose an answer to filter the list.`}
      >
        {rows.map((row) => {
          const now = byValue.get(row.value);
          const count = now?.count ?? 0;
          const pct = now?.pct ?? 0;
          const on = selected === row.value;
          const dim = selected !== null && !on;
          return (
            <button
              key={row.value}
              type="button"
              className={`rsp-sum-bar${dim ? ' is-dim' : ''}${count === 0 ? ' is-zero' : ''}`}
              aria-pressed={on}
              aria-label={`${row.label}: ${plural(count, 'response', 'responses')}, ${pct}%${
                crossed ? ' of matching' : ''
              }. Filter the list to this answer.`}
              tabIndex={row.value === tabStop ? 0 : -1}
              onFocus={() => setCursor(row.value)}
              onClick={() => onToggle(question.id, row.value)}
            >
              <span className="rsp-sum-bar-label" title={row.label} dir="auto">
                {row.label}
              </span>
              <span className="rsp-sum-bar-track" aria-hidden="true">
                {crossed ? (
                  <span
                    className="rsp-sum-bar-ghost"
                    style={{ width: barWidth(row.count, total.max) }}
                  />
                ) : null}
                <span className="rsp-sum-bar-fill" style={{ width: barWidth(count, total.max) }} />
              </span>
              <span className="rsp-sum-bar-n" aria-hidden="true">
                {count}
              </span>
              <span className="rsp-sum-bar-pct" aria-hidden="true">
                {current.answered ? `${pct}%` : '–'}
              </span>
            </button>
          );
        })}
      </div>
      {foldable ? (
        <button
          type="button"
          className="rsp-textbtn rsp-sum-chart-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show less' : `Show ${hidden} more`}
        </button>
      ) : null}
    </article>
  );
});

/* ---------- responses table ---------- */

type RowProps = {
  sub: StoredSubmission;
  number: number;
  total: number;
  questions: Question[];
  cols: TableColumns;
  /** Question ids with an active answer filter (their cells read stronger). */
  activeQs: ReadonlySet<string>;
  isUnread: boolean;
  isOpen: boolean;
  phone: boolean;
  now: Date;
  medianMs: number | null;
  formName: string;
  panelId: string;
  onToggle(id: string): void;
  onMarkRead(ids: string[]): void;
  onMarkUnread(id: string): void;
  onTrash(id: string): void;
};

const SummaryRow = memo(function SummaryRow({
  sub,
  number,
  total,
  questions,
  cols,
  activeQs,
  isUnread,
  isOpen,
  phone,
  now,
  medianMs,
  formName,
  panelId,
  onToggle,
  onMarkRead,
  onMarkUnread,
  onTrash,
}: RowProps) {
  const cells = useMemo(
    () => ({
      name: respondentName(questions, sub.answers, number),
      anonymous: namedRespondent(questions, sub.answers) === null,
      choices: cols.choices.map((q) => ({
        id: q.id,
        text: answerText(q, sub.answers[q.id]).replace(/\n/g, ', '),
      })),
      text: cols.text ? answerPreview(sub, cols.text) : '',
      files: hasFiles(sub, questions),
    }),
    [sub, questions, cols, number],
  );
  const age = relativeAge(sub.receivedAt, now);
  const when = fullDate(sub.receivedAt, now);
  const cls = `rsp-sum-item${isOpen ? ' is-open' : ''}${isUnread ? ' is-unread' : ''}`;

  const dot = (
    <span className="rsp-sum-c-dot">
      {isUnread ? (
        <>
          <span className="rsp-dot" aria-hidden="true" />
          <span className="rsp-sr">Unread. </span>
        </>
      ) : null}
    </span>
  );
  const clip = cells.files ? (
    <>
      <IconClip size={15} />
      <span className="rsp-sr">Has files. </span>
    </>
  ) : null;
  const time = (
    <time className="rsp-sum-c-time" dateTime={sub.receivedAt} title={when}>
      {age}
    </time>
  );
  const chev = (
    <span className="rsp-sum-c-chev" aria-hidden="true">
      <IconChevronDown />
    </span>
  );

  return (
    <li className={cls} data-item={sub.id}>
      <button
        type="button"
        className={`rsp-sum-row${phone ? ' rsp-sum-row--card' : ''}`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        data-fkey={`row-${sub.id}`}
        onClick={() => onToggle(sub.id)}
      >
        {phone ? (
          <>
            <span className="rsp-sum-card-top">
              {dot}
              <span className="rsp-sum-c-name" dir="auto">
                {cells.name}
              </span>
              <span className="rsp-sum-c-file">{clip}</span>
              {time}
              {chev}
            </span>
            {cells.choices.some((c) => c.text) ? (
              <span className="rsp-sum-chips">
                {cells.choices.map((c) =>
                  c.text ? (
                    <span
                      key={c.id}
                      className={`rsp-sum-chip${activeQs.has(c.id) ? ' is-on' : ''}`}
                      dir="auto"
                    >
                      {c.text}
                    </span>
                  ) : null,
                )}
              </span>
            ) : null}
            {cells.text ? (
              <span className="rsp-sum-card-text" dir="auto">
                {cells.text}
              </span>
            ) : null}
          </>
        ) : (
          <>
            {dot}
            <span className="rsp-sum-c-name" dir="auto">
              {cells.name}
            </span>
            {cells.choices.map((c) => (
              <span
                key={c.id}
                className={`rsp-sum-c-choice${activeQs.has(c.id) ? ' is-on' : ''}`}
                dir="auto"
              >
                {c.text || <span aria-hidden="true">—</span>}
              </span>
            ))}
            <span className="rsp-sum-c-text" dir="auto">
              {cells.text || (cols.text ? <span aria-hidden="true">—</span> : null)}
            </span>
            <span className="rsp-sum-c-file">{clip}</span>
            {time}
            {chev}
          </>
        )}
      </button>
      {isOpen ? (
        <div
          className="rsp-sum-panel"
          id={panelId}
          role="region"
          aria-label={cells.anonymous ? cells.name : `Response from ${cells.name}`}
        >
          <ResponseAnswers questions={questions} answers={sub.answers} layout="grid" />
          <div className="rsp-sum-aside">
            <dl className="rsp-sum-meta">
              <div>
                <dt>Received</dt>
                <dd>{when}</dd>
              </div>
              <div>
                <dt>Time to complete</dt>
                <dd>
                  {formatDuration(sub.meta?.durationMs)}
                  {medianMs !== null && durationParts(sub.meta?.durationMs) ? (
                    <span className="rsp-sum-meta-aside"> · median {formatDuration(medianMs)}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Response</dt>
                <dd>
                  #{number} of {total}
                </dd>
              </div>
            </dl>
            <ResponseActions
              sub={sub}
              questions={questions}
              formName={formName}
              mode="responses"
              isUnread={isUnread}
              variant="panel"
              onMarkRead={onMarkRead}
              onMarkUnread={onMarkUnread}
              onTrash={onTrash}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
});

/* ---------- the view ---------- */

export function ResponsesSummary(props: SummaryProps) {
  const { subs, questions, unread, formName, onMarkRead } = props;
  const onMarkUnreadProp = props.onMarkUnread;
  const onTrashProp = props.onTrash;
  const now = useNow();
  const phone = usePhone();
  const markAll = useMarkAllRead(onMarkRead, onMarkUnreadProp);
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(SUMMARY_PAGE);
  const [live, setLive] = useState('');
  /**
   * `data-fkey`s to try, in order, once the next render lands. Focus only
   * moves if the focused control went away (or was disabled), unless forced.
   */
  const pendingFocus = useRef<{ keys: string[]; force: boolean } | null>(null);
  /** Row to keep in view after it opens. */
  const revealId = useRef<string | null>(null);
  const filtersChanged = useRef(false);

  const numbers = useMemo(() => responseNumbers(subs), [subs]);
  const k = useMemo(() => kpis(subs, unread, now), [subs, unread, now]);
  const weekStartMs = k.weekStart.getTime();
  const chartQs = useMemo(() => chartableQuestions(questions), [questions]);
  const qNumbers = useMemo(
    () => new Map(questions.map((q, i) => [q.id, i + 1] as const)),
    [questions],
  );
  const cols = useMemo(() => tableColumns(questions), [questions]);
  const templates = useMemo(() => columnTemplates(cols), [cols]);
  const totals = useMemo(
    () => new Map(chartQs.map((q) => [q.id, questionDistribution(q, subs)] as const)),
    [chartQs, subs],
  );
  const crossed = useMemo(() => {
    const out = new Map<string, Distribution>();
    for (const q of chartQs) {
      if (filterCount(filters, q.id) === 0) continue;
      const subset = subs.filter((s) => matches(s, filters, weekStartMs, q.id));
      out.set(q.id, questionDistribution(q, subset));
    }
    return out;
  }, [chartQs, subs, filters, weekStartMs]);

  const active = filterCount(filters);
  const filtered = useMemo(
    () => (active ? subs.filter((s) => matches(s, filters, weekStartMs)) : subs),
    [active, subs, filters, weekStartMs],
  );
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const groups = useMemo(() => dayGroups(visible, now), [visible, now]);
  const groupTotals = useMemo(() => {
    const counts = new Map<string, number>();
    if (filtered.length <= limit) return counts;
    for (const s of filtered) {
      const key = dayGroupOf(s.receivedAt, now).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filtered, limit, now]);
  const activeQs = useMemo(
    () => new Set(filters.answers.map((a) => a.questionId)),
    [filters.answers],
  );
  const selectedByQ = useMemo(
    () => new Map(filters.answers.map((a) => [a.questionId, a.value] as const)),
    [filters.answers],
  );
  const unreadHere = useMemo(() => unreadIds(subs, unread), [subs, unread]);
  // A row filtered out (or trashed) closes.
  const open = openId && filtered.some((s) => s.id === openId) ? openId : null;

  const latest = useRef({ visible, filtered, questions, numbers });
  latest.current = { visible, filtered, questions, numbers };

  const focusLater = useCallback((keys: string[], force = false) => {
    pendingFocus.current = { keys, force };
  }, []);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const root = rootRef.current;
    if (!pending || !root) return;
    pendingFocus.current = null;
    const current = document.activeElement;
    const lost =
      !(current instanceof HTMLElement) ||
      current === document.body ||
      !current.isConnected ||
      (current as HTMLButtonElement).disabled === true;
    if (!lost && !pending.force) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-fkey]'));
    for (const key of pending.keys) {
      const el = nodes.find((n) => n.dataset.fkey === key);
      if (el && !(el as HTMLButtonElement).disabled) {
        el.focus({ preventScroll: true });
        return;
      }
    }
  });

  // Filters changed: announce the count, and if the list was scrolled past
  // its own top, bring the start of the result back into view.
  useEffect(() => {
    if (!filtersChanged.current) return;
    filtersChanged.current = false;
    // A row the filter hid stays closed when the filter goes away.
    if (openId !== null && open === null) setOpenId(null);
    const total = plural(subs.length, 'response', 'responses');
    setLive(active ? `Showing ${filtered.length} of ${total}.` : `Showing all ${total}.`);
    const list = listRef.current;
    const root = rootRef.current;
    if (!list || !root) return;
    const top = list.getBoundingClientRect().top;
    const limitTop = studioHeaderBottom(root);
    if (top < limitTop) window.scrollBy({ top: top - limitTop });
  }, [filters, active, filtered.length, subs.length, openId, open]);

  // A row just opened: keep it in view below the sticky headers.
  useEffect(() => {
    const id = revealId.current;
    const root = rootRef.current;
    if (!id || !root || open !== id) return;
    revealId.current = null;
    const raf = window.requestAnimationFrame(() => {
      const item = Array.from(root.querySelectorAll<HTMLElement>('[data-item]')).find(
        (n) => n.dataset.item === id,
      );
      if (!item) return;
      const r = item.getBoundingClientRect();
      const head = headRef.current;
      const sticky = head && getComputedStyle(head).position === 'sticky';
      const topLimit =
        Math.max(studioHeaderBottom(root), sticky ? head.getBoundingClientRect().bottom : 0) + 8;
      const bottomLimit = window.innerHeight - 12;
      let delta = 0;
      if (r.bottom > bottomLimit) delta = r.bottom - bottomLimit;
      if (r.top - delta < topLimit) delta = r.top - topLimit;
      if (Math.abs(delta) > 1) {
        window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  const changeFilters = useCallback((next: (f: Filters) => Filters) => {
    filtersChanged.current = true;
    setFilters(next);
    setLimit(SUMMARY_PAGE);
  }, []);

  const toggleAnswer = useCallback(
    (questionId: string, value: string) => {
      changeFilters((f) => {
        const current = f.answers.find((a) => a.questionId === questionId);
        const rest = f.answers.filter((a) => a.questionId !== questionId);
        return {
          ...f,
          answers: current?.value === value ? rest : [...rest, { questionId, value }],
        };
      });
    },
    [changeFilters],
  );

  const unreadRef = useRef(unreadHere);
  unreadRef.current = unreadHere;

  const toggleNew = useCallback(() => {
    changeFilters((f) => ({ ...f, newIds: f.newIds ? null : new Set(unreadRef.current) }));
    focusLater(['kpi-new', 'title']);
  }, [changeFilters, focusLater]);

  const toggleWeek = useCallback(() => {
    changeFilters((f) => ({ ...f, week: !f.week }));
    focusLater(['kpi-week', 'title']);
  }, [changeFilters, focusLater]);

  const clearAll = useCallback(() => {
    changeFilters(() => NO_FILTERS);
    focusLater(['title']);
  }, [changeFilters, focusLater]);

  /** Pill keys in display order, for moving focus after one is removed. */
  const pillKeys = [
    ...filters.answers.map((a) => `pill-q-${a.questionId}`),
    ...(filters.newIds ? ['pill-new'] : []),
    ...(filters.week ? ['pill-week'] : []),
  ];

  const removePill = (key: string, apply: (f: Filters) => Filters) => {
    const i = pillKeys.indexOf(key);
    const rest = pillKeys.filter((p) => p !== key);
    const after = [...rest.slice(Math.max(0, i)), ...rest.slice(0, Math.max(0, i)).reverse()];
    changeFilters(apply);
    focusLater([...after, 'title']);
  };

  // Read through a ref so the callback (and every memoized row) stays stable.
  const rowState = useRef({ open, unread });
  rowState.current = { open, unread };

  const onToggleRow = useCallback(
    (id: string) => {
      if (rowState.current.open === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      revealId.current = id;
      if (rowState.current.unread.has(id)) onMarkRead([id]);
    },
    [onMarkRead],
  );

  /** The open row's read toggle. The row stays open, as in the Inbox. */
  const announce = useCallback((id: string, read: boolean) => {
    const { questions: qs, filtered: list, numbers: nums } = latest.current;
    const sub = list.find((s) => s.id === id);
    if (sub) {
      const name = respondentName(qs, sub.answers, nums.get(id) ?? 0);
      setLive(`${name} marked as ${read ? 'read' : 'unread'}.`);
    }
  }, []);

  const onMarkReadAction = useCallback(
    (ids: string[]) => {
      onMarkRead(ids);
      if (ids.length === 1) announce(ids[0]!, true);
    },
    [onMarkRead, announce],
  );

  const onMarkUnread = useCallback(
    (id: string) => {
      onMarkUnreadProp(id);
      announce(id, false);
    },
    [onMarkUnreadProp, announce],
  );

  const onTrash = useCallback(
    (id: string) => {
      const list = latest.current.visible;
      const i = list.findIndex((s) => s.id === id);
      const next = list[i + 1]?.id;
      const prev = list[i - 1]?.id;
      focusLater([...(next ? [`row-${next}`] : []), ...(prev ? [`row-${prev}`] : []), 'title']);
      setOpenId(null);
      onTrashProp(id);
    },
    [onTrashProp, focusLater],
  );

  const markAllRead = () => markAll(unreadHere);

  const showMore = () => {
    const first = filtered[limit]?.id;
    setLimit((n) => n + SUMMARY_PAGE);
    if (first) focusLater([`row-${first}`], true);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const root = rootRef.current;
    const target = e.target as HTMLElement;
    if (!root) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      let group: HTMLElement[] | null = null;
      if (target.classList.contains('rsp-sum-row')) {
        group = Array.from(root.querySelectorAll<HTMLElement>('.rsp-sum-row'));
      } else if (target.classList.contains('rsp-sum-bar') && target.parentElement) {
        group = Array.from(target.parentElement.querySelectorAll<HTMLElement>('.rsp-sum-bar'));
      }
      if (!group || group.length === 0) return;
      const i = group.indexOf(target);
      const j =
        e.key === 'ArrowDown'
          ? Math.min(group.length - 1, i + 1)
          : e.key === 'ArrowUp'
            ? Math.max(0, i - 1)
            : e.key === 'Home'
              ? 0
              : group.length - 1;
      e.preventDefault();
      if (j !== i) group[j]?.focus();
    } else if (e.key === 'Escape') {
      if (isOverlayOpen()) return;
      if (open) {
        e.preventDefault();
        setOpenId(null);
        focusLater([`row-${open}`]);
      } else if (active) {
        e.preventDefault();
        clearAll();
      }
    }
  };

  const hint = chartQs.length
    ? `${phone ? 'Tap' : 'Click'} a bar or tile above to filter`
    : `${phone ? 'Tap' : 'Click'} a tile above to filter`;
  const topClass =
    chartQs.length === 0
      ? ' rsp-sum-top--c0'
      : chartQs.length === 1
        ? ' rsp-sum-top--c1'
        : ' rsp-sum-top--cn';
  const colsStyle = {
    '--rsp-sum-cols': templates.wide,
    '--rsp-sum-cols-mid': templates.mid,
  } as CSSProperties;

  return (
    <div className="rsp-sum" ref={rootRef} onKeyDown={onKeyDown}>
      <section className={`rsp-sum-top${topClass}`} aria-labelledby={`${uid}-summary`}>
        {/* Keeps the outline h1 → h2 → h3 (charts); absolutely positioned, so no grid cell. */}
        <h2 className="rsp-sr" id={`${uid}-summary`}>
          Summary
        </h2>
        <KpiTiles
          k={k}
          newOn={filters.newIds !== null}
          weekOn={filters.week}
          onToggleNew={toggleNew}
          onToggleWeek={toggleWeek}
        />
        {chartQs.map((q) => (
          <ChartCard
            key={q.id}
            question={q}
            number={qNumbers.get(q.id) ?? 0}
            total={totals.get(q.id)!}
            crossed={crossed.get(q.id) ?? null}
            selected={selectedByQ.get(q.id) ?? null}
            onToggle={toggleAnswer}
          />
        ))}
      </section>

      <section
        className="rsp-sum-list"
        ref={listRef}
        aria-labelledby={`${uid}-title`}
        style={colsStyle}
      >
        <div className="rsp-sum-head" ref={headRef}>
          <div className="rsp-sum-toolbar">
            <div className="rsp-sum-heading">
              <h2 className="rsp-sum-title" id={`${uid}-title`} tabIndex={-1} data-fkey="title">
                Responses
              </h2>
              <span className="rsp-sum-count">
                {active ? `${filtered.length} of ${subs.length}` : subs.length}
              </span>
            </div>
            <div className="rsp-sum-pills">
              {active === 0 ? (
                <span className="rsp-sum-hint">
                  <IconArrowUp size={14} />
                  {hint}
                </span>
              ) : (
                <>
                  {filters.answers.map((a) => {
                    const q = questions.find((x) => x.id === a.questionId);
                    const qTitle = q ? titleOf(q) : a.questionId;
                    const label =
                      totals.get(a.questionId)?.rows.find((r) => r.value === a.value)?.label ??
                      a.value;
                    const key = `pill-q-${a.questionId}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        className="rsp-sum-pill"
                        data-fkey={key}
                        aria-label={`Remove filter: ${qTitle} ${label}`}
                        title={`${qTitle} ${label}`}
                        onClick={() =>
                          removePill(key, (f) => ({
                            ...f,
                            answers: f.answers.filter((x) => x.questionId !== a.questionId),
                          }))
                        }
                      >
                        <span className="rsp-sum-pill-face">
                          <span className="rsp-sum-pill-q" dir="auto">
                            {qTitle}
                          </span>
                          <span className="rsp-sum-pill-v" dir="auto">
                            {label}
                          </span>
                          <span className="rsp-sum-pill-x" aria-hidden="true">
                            <IconX size={12} />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {filters.newIds ? (
                    <button
                      type="button"
                      className="rsp-sum-pill"
                      data-fkey="pill-new"
                      aria-label="Remove filter: New"
                      onClick={() => removePill('pill-new', (f) => ({ ...f, newIds: null }))}
                    >
                      <span className="rsp-sum-pill-face">
                        <span className="rsp-dot" aria-hidden="true" />
                        <span className="rsp-sum-pill-v">New</span>
                        <span className="rsp-sum-pill-x" aria-hidden="true">
                          <IconX size={12} />
                        </span>
                      </span>
                    </button>
                  ) : null}
                  {filters.week ? (
                    <button
                      type="button"
                      className="rsp-sum-pill"
                      data-fkey="pill-week"
                      aria-label="Remove filter: This week"
                      onClick={() => removePill('pill-week', (f) => ({ ...f, week: false }))}
                    >
                      <span className="rsp-sum-pill-face">
                        <span className="rsp-sum-pill-v">This week</span>
                        <span className="rsp-sum-pill-x" aria-hidden="true">
                          <IconX size={12} />
                        </span>
                      </span>
                    </button>
                  ) : null}
                  {active > 1 ? (
                    <button type="button" className="rsp-textbtn" onClick={clearAll}>
                      Clear all
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <button
              type="button"
              className="rsp-textbtn rsp-sum-readall"
              aria-disabled={unreadHere.length === 0}
              title={
                unreadHere.length === 0
                  ? 'Nothing unread'
                  : `Mark ${plural(unreadHere.length, 'response', 'responses')} as read`
              }
              onClick={markAllRead}
            >
              <IconCheckAll />
              <span>Mark all read</span>
            </button>
          </div>
          {phone ? null : (
            <div className="rsp-sum-cols" aria-hidden="true">
              <span />
              <span>Respondent</span>
              {cols.choices.map((q) => (
                <span
                  key={q.id}
                  className={activeQs.has(q.id) ? 'is-on' : undefined}
                  title={titleOf(q)}
                >
                  {titleOf(q)}
                </span>
              ))}
              <span title={cols.text ? titleOf(cols.text) : undefined}>
                {cols.text ? titleOf(cols.text) : ''}
              </span>
              <span />
              <span className="is-end">Received</span>
              <span />
            </div>
          )}
        </div>

        <div className="rsp-sum-rows">
          {filtered.length === 0 ? (
            <div className="rsp-empty rsp-empty--center rsp-sum-empty">
              <p className="rsp-empty-title">No responses match</p>
              <p className="rsp-empty-copy">Try removing a filter.</p>
              <button type="button" className="rsp-btn" onClick={clearAll}>
                Show all {plural(subs.length, 'response', 'responses')}
              </button>
            </div>
          ) : (
            groups.map((g) => {
              const count = groupTotals.get(g.key) ?? g.items.length;
              return (
                <div key={g.key} className="rsp-sum-group">
                  <h3 className="rsp-sum-grouphead">
                    <span>{g.label}</span>
                    <span className="rsp-sum-group-n" aria-hidden="true">
                      {count}
                    </span>
                    <span className="rsp-sr">, {plural(count, 'response', 'responses')}</span>
                  </h3>
                  <ul className="rsp-sum-items">
                    {g.items.map((s) => (
                      <SummaryRow
                        key={s.id}
                        sub={s}
                        number={numbers.get(s.id) ?? 0}
                        total={subs.length}
                        questions={questions}
                        cols={cols}
                        activeQs={activeQs}
                        isUnread={unread.has(s.id)}
                        isOpen={open === s.id}
                        phone={phone}
                        now={now}
                        medianMs={k.medianMs}
                        formName={formName}
                        panelId={`${uid}-panel-${s.id}`}
                        onToggle={onToggleRow}
                        onMarkRead={onMarkReadAction}
                        onMarkUnread={onMarkUnread}
                        onTrash={onTrash}
                      />
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        {filtered.length > limit ? (
          <div className="rsp-sum-more">
            <button type="button" className="rsp-btn" onClick={showMore}>
              Show {Math.min(SUMMARY_PAGE, filtered.length - limit)} more
            </button>
            <span className="rsp-sum-more-n">
              {limit} of {filtered.length}
            </span>
          </div>
        ) : null}
        <p className="rsp-sr" aria-live="polite">
          {live}
        </p>
      </section>
    </div>
  );
}
