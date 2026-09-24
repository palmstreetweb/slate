import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question } from '../src/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
// File previews read IndexedDB / storage; they have their own tests.
vi.mock('../examples/_admin/components/ResponseFileAnswer.js', () => ({
  ResponseFileAnswer: () => <span>file preview</span>,
}));

import { ResponsesSummary, SUMMARY_PAGE } from '../examples/_admin/responses/ResponsesSummary.js';
import { ToastProvider } from '../examples/_admin/toast.js';

const calls = {
  markRead: vi.fn<(ids: string[]) => void>(),
  markUnread: vi.fn<(id: string) => void>(),
  trash: vi.fn<(id: string) => void>(),
};

const questions = [
  { id: 'name', type: 'short_text', title: "What's your name?" },
  { id: 'email', type: 'email', title: 'Best email to reach you' },
  {
    id: 'need',
    type: 'single_choice',
    title: 'What do you need?',
    options: [
      { label: 'Repair', value: 'repair' },
      { label: 'Quote', value: 'quote' },
      { label: 'New install', value: 'install' },
    ],
  },
  {
    id: 'extras',
    type: 'multi_choice',
    title: 'Extras',
    options: [
      { label: 'Heater', value: 'heater' },
      { label: 'Lights', value: 'lights' },
      { label: 'Cover', value: 'cover' },
    ],
  },
  { id: 'rating', type: 'scale', title: 'Overall rating', min: 1, max: 5 },
  { id: 'notes', type: 'long_text', title: 'Anything else?' },
  { id: 'photo', type: 'file_upload', title: 'Photo' },
] as unknown as Question[];

/** Wednesday, Sep 23 2026, noon local time — the week started Monday Sep 21. */
const NOW = new Date(2026, 8, 23, 12, 0, 0);

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

function sub(
  id: string,
  receivedAt: string,
  answers: Record<string, unknown>,
  durationMs = 60_000,
): StoredSubmission {
  return {
    id,
    formId: 'f1',
    receivedAt,
    answers,
    meta: {
      startedAt: receivedAt,
      completedAt: receivedAt,
      durationMs,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
  } as StoredSubmission;
}

/** Newest first, like the page passes them. */
const SUBS: StoredSubmission[] = [
  sub(
    's1',
    at(23, 11, 58),
    {
      name: 'Nora Fischer',
      email: 'nora@example.com',
      need: 'repair',
      extras: ['heater', 'lights'],
      rating: 5,
      notes: "Heater won't ignite.",
    },
    79_000,
  ),
  sub(
    's2',
    at(22, 9),
    {
      name: 'Kai Nakamura',
      email: 'kai@example.com',
      need: 'quote',
      extras: ['cover'],
      rating: 4,
    },
    60_000,
  ),
  sub(
    's3',
    at(21, 10),
    {
      name: 'Ava Park',
      email: 'not an email?@x',
      need: 'repair',
      extras: ['heater'],
      rating: 4,
      notes: 'Leak near the skimmer.',
    },
    120_000,
  ),
  sub('s4', at(16, 10), { name: 'Leo Martins', need: 'install', extras: [], rating: 3 }, 30_000),
  sub(
    's5',
    at(2, 10),
    {
      name: 'Diego Ruiz',
      need: 'quote',
      extras: ['heater', 'cover', 'lights'],
      rating: 5,
      photo: ['slate-file://abc'],
    },
    90_000,
  ),
];

type HarnessProps = { subs?: StoredSubmission[]; qs?: Question[]; unread?: string[] };

/** Stands in for the page: owns read state and trash, like FormSubmissions. */
function Harness({ subs = SUBS, qs = questions, unread: initial = ['s1', 's2'] }: HarnessProps) {
  const [list, setList] = useState(subs);
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set(initial));
  const onMarkRead = useCallback((ids: string[]) => {
    calls.markRead(ids);
    setUnread((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }, []);
  const onMarkUnread = useCallback((id: string) => {
    calls.markUnread(id);
    setUnread((prev) => new Set([id, ...prev]));
  }, []);
  const onTrash = useCallback((id: string) => {
    calls.trash(id);
    setList((prev) => prev.filter((s) => s.id !== id));
  }, []);
  return (
    <div data-slate-forms="" data-theme-name="slate">
      <div className="slate-rsp">
        <ResponsesSummary
          formId="f1"
          formName="Pool sign-up"
          questions={qs}
          subs={list}
          unread={unread}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          onTrash={onTrash}
        />
      </div>
    </div>
  );
}

function listRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Responses' });
}

/** Respondent names of the rendered rows, top to bottom. */
function rowNames(): string[] {
  return Array.from(listRegion().querySelectorAll('.rsp-sum-row .rsp-sum-c-name')).map(
    (n) => n.textContent ?? '',
  );
}

function row(name: string): HTMLElement {
  const el = Array.from(listRegion().querySelectorAll<HTMLElement>('.rsp-sum-row')).find(
    (b) => b.querySelector('.rsp-sum-c-name')?.textContent === name,
  );
  if (!el) throw new Error(`No row for ${name}`);
  return el;
}

function count(): string {
  return listRegion().querySelector('.rsp-sum-count')?.textContent ?? '';
}

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // jsdom has no layout or scrolling.
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  consoleError = vi.spyOn(console, 'error');
  calls.markRead.mockReset();
  calls.markUnread.mockReset();
  calls.trash.mockReset();
});

afterEach(() => {
  const errors = consoleError.mock.calls.map((args) => String(args[0]));
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(errors).toEqual([]);
});

describe('Responses — Summary view', () => {
  it('shows total, unread, the week against last week, and the median time', () => {
    render(<Harness />);
    const kpis = screen.getByRole('group', { name: 'Key numbers' });

    expect(within(kpis).getByText('Responses').parentElement).toHaveTextContent('5');
    expect(
      within(kpis).getByRole('img', { name: /^Responses per day, Sep 10 to Sep 23/ }),
    ).toBeInTheDocument();

    const fresh = within(kpis).getByRole('button', { name: /^New: 2 unread/ });
    expect(fresh).toHaveAttribute('aria-pressed', 'false');
    expect(fresh).toHaveTextContent('unread');

    // Sep 21–23 this week (3) against Sep 14–20 (1).
    const week = within(kpis).getByRole('button', { name: /^This week: 3, 1 last week/ });
    expect(week).toHaveTextContent('+2');
    expect(week).toHaveTextContent('vs last week');

    // 30s, 60s, 79s, 90s, 120s.
    expect(within(kpis).getByText('Median time').parentElement).toHaveTextContent('1m 19s');
    expect(within(kpis).getByText('to complete')).toBeInTheDocument();
  });

  it('says so when this week is behind or level with last week', () => {
    const behind = [SUBS[0]!, sub('a', at(15, 9), {}), sub('b', at(17, 9), {})];
    const first = render(<Harness subs={behind} unread={[]} />);
    const week = screen.getByRole('button', { name: /^This week: 1, 2 last week/ });
    expect(week).toHaveTextContent('1 vs last week');
    expect(week).not.toHaveTextContent('+');
    // Nothing unread: the New tile can't filter to nothing.
    expect(screen.getByRole('button', { name: /^New: 0 unread/ })).toBeDisabled();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    first.unmount();

    render(<Harness subs={[SUBS[0]!, sub('a', at(15, 9), {})]} />);
    expect(screen.getByRole('button', { name: /^This week/ })).toHaveTextContent(
      'Same as last week',
    );
  });

  it('filters the list from a bar, shows a pill, and Clear all resets', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('Click a bar or tile above to filter')).toBeInTheDocument();
    expect(count()).toBe('5');

    const repair = screen.getByRole('button', { name: /^Repair: 2 responses, 40%/ });
    await user.click(repair);
    expect(repair).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['Nora Fischer', 'Ava Park']);
    expect(count()).toBe('2 of 5');
    expect(screen.queryByText('Click a bar or tile above to filter')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove filter: What do you need? Repair' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 5 responses.')).toBeInTheDocument();

    // Other charts re-count against the filter: Extras answered by 2 of 4.
    const extras = screen.getByRole('article', { name: /Extras/ });
    expect(extras).toHaveTextContent('2 of 4 match');

    // Another answer to the same question replaces the first.
    await user.click(screen.getByRole('button', { name: /^Quote: 2 responses/ }));
    expect(rowNames()).toEqual(['Kai Nakamura', 'Diego Ruiz']);
    expect(screen.getAllByRole('button', { name: /^Remove filter/ })).toHaveLength(1);

    // Filters on different questions AND together; Clear all appears at two.
    await user.click(screen.getByRole('button', { name: /^Heater: 1 response, 50% of matching/ }));
    expect(rowNames()).toEqual(['Diego Ruiz']);
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
    // Counts follow the other filters: nobody asked for an install with a heater.
    await user.click(screen.getByRole('button', { name: /^New install: 0 responses/ }));
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('No responses match')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(rowNames()).toHaveLength(5);
    expect(count()).toBe('5');
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument();
    expect(screen.getByText('Click a bar or tile above to filter')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Responses' })).toHaveFocus();
    expect(screen.getByText('Showing all 5 responses.')).toBeInTheDocument();
  });

  it('removes one filter from its pill and keeps focus in the pill row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Repair:/ }));
    await user.click(screen.getByRole('button', { name: /^This week:/ }));
    expect(count()).toBe('2 of 5');

    await user.click(
      screen.getByRole('button', { name: 'Remove filter: What do you need? Repair' }),
    );
    expect(rowNames()).toEqual(['Nora Fischer', 'Kai Nakamura', 'Ava Park']);
    const weekPill = screen.getByRole('button', { name: 'Remove filter: This week' });
    expect(weekPill).toHaveFocus();

    await user.click(weekPill);
    expect(rowNames()).toHaveLength(5);
    expect(screen.getByRole('heading', { level: 2, name: 'Responses' })).toHaveFocus();
  });

  it('New and This week tiles are filter toggles', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const fresh = screen.getByRole('button', { name: /^New:/ });
    await user.click(fresh);
    expect(fresh).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['Nora Fischer', 'Kai Nakamura']);

    // Reading a row keeps it in the New list until the filter is switched off.
    await user.click(row('Nora Fischer'));
    expect(calls.markRead).toHaveBeenCalledWith(['s1']);
    expect(rowNames()).toEqual(['Nora Fischer', 'Kai Nakamura']);
    expect(screen.getByRole('button', { name: /^New: 1 unread/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: /^New:/ }));
    expect(screen.getByRole('button', { name: /^New:/ })).toHaveAttribute('aria-pressed', 'false');
    expect(rowNames()).toHaveLength(5);

    const week = screen.getByRole('button', { name: /^This week:/ });
    await user.click(week);
    expect(week).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['Nora Fischer', 'Kai Nakamura', 'Ava Park']);
    expect(week).toHaveFocus();
  });

  it('expands one row at a time, marks it read, and shows answers and actions', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const nora = row('Nora Fischer');
    expect(nora).toHaveAttribute('aria-expanded', 'false');
    expect(nora).toHaveTextContent('Unread.');

    await user.click(nora);
    expect(calls.markRead).toHaveBeenCalledWith(['s1']);
    expect(nora).toHaveAttribute('aria-expanded', 'true');
    expect(nora).not.toHaveTextContent('Unread.');
    const panel = screen.getByRole('region', { name: 'Response from Nora Fischer' });
    expect(nora).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByText('Anything else?')).toBeInTheDocument();
    expect(within(panel).getByText("Heater won't ignite.")).toBeInTheDocument();
    expect(within(panel).getByText('Heater, Lights')).toBeInTheDocument();
    expect(within(panel).getByText('Received')).toBeInTheDocument();
    expect(within(panel).getByText('#5 of 5')).toBeInTheDocument();
    expect(within(panel).getByText('Time to complete').nextElementSibling).toHaveTextContent(
      '1m 19s · median 1m 19s',
    );
    expect(within(panel).getByRole('button', { name: 'Move to trash' })).toBeInTheDocument();

    // Only one open at a time.
    await user.click(row('Kai Nakamura'));
    expect(nora).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Response from Nora Fischer' })).toBeNull();
    expect(row('Kai Nakamura')).toHaveAttribute('aria-expanded', 'true');

    // Mark unread keeps the row open, as the Inbox keeps its reader open,
    // and the same button now offers Mark read.
    await user.click(screen.getByRole('button', { name: 'Mark unread' }));
    expect(calls.markUnread).toHaveBeenCalledWith('s2');
    expect(row('Kai Nakamura')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Kai Nakamura')).toHaveTextContent('Unread.');
    expect(screen.getByText('Kai Nakamura marked as unread.')).toBeInTheDocument();
    const markRead = screen.getByRole('button', { name: 'Mark read' });
    expect(markRead).toHaveFocus();

    await user.click(markRead);
    expect(calls.markRead).toHaveBeenLastCalledWith(['s2']);
    expect(row('Kai Nakamura')).not.toHaveTextContent('Unread.');
    expect(screen.getByText('Kai Nakamura marked as read.')).toBeInTheDocument();
  });

  it('closes a row the filter hides, and it stays closed after', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(row('Nora Fischer'));
    const quote = screen.getByRole('button', { name: /^Quote:/ });
    await user.click(quote);
    expect(rowNames()).not.toContain('Nora Fischer');
    expect(screen.queryByRole('region', { name: /^Response from/ })).toBeNull();

    await user.click(quote);
    expect(row('Nora Fischer')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: /^Response from/ })).toBeNull();
  });

  it('offers Reply only for an address that passes the strict check', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(row('Nora Fischer'));
    // jsdom's name computation drops the space before the inline " to Nora".
    const reply = screen.getByRole('link', { name: /^Reply ?to Nora$/ });
    expect(reply).toHaveAttribute('href', 'mailto:nora@example.com?subject=Re%3A%20Pool%20sign-up');

    await user.click(row('Ava Park'));
    const panel = screen.getByRole('region', { name: 'Response from Ava Park' });
    expect(within(panel).queryByRole('link')).toBeNull();
    expect(within(panel).getByText('not an email?@x')).toBeInTheDocument();
  });

  it('charts multi-choice by share of respondents and ratings in order with an average', () => {
    render(<Harness />);
    const extras = screen.getByRole('article', { name: /Extras/ });
    const bars = within(extras)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    // Four people answered; shares add up to more than 100%.
    expect(bars).toEqual([
      'Heater: 3 responses, 75%. Filter the list to this answer.',
      'Lights: 2 responses, 50%. Filter the list to this answer.',
      'Cover: 2 responses, 50%. Filter the list to this answer.',
    ]);
    expect(extras).toHaveTextContent('4 answers');

    const rating = screen.getByRole('article', { name: /Overall rating/ });
    expect(
      within(rating)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')?.split(':')[0]),
    ).toEqual(['1', '2', '3', '4', '5']);
    expect(rating).toHaveTextContent('avg 4.2');
    expect(within(rating).getByRole('button', { name: /^4: 2 responses, 40%/ })).toBeTruthy();
    expect(within(rating).getByText('Q5')).toBeInTheDocument();
  });

  it('gives each chart one tab stop; arrow keys move between its bars', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const need = screen.getByRole('article', { name: /What do you need/ });
    const tabStops = () =>
      within(need)
        .getAllByRole('button')
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.getAttribute('aria-label')?.split(':')[0]);
    expect(tabStops()).toEqual(['Repair']);

    const repair = within(need).getByRole('button', { name: /^Repair:/ });
    act(() => repair.focus());
    await user.keyboard('{ArrowDown}');
    const quote = within(need).getByRole('button', { name: /^Quote:/ });
    expect(quote).toHaveFocus();
    expect(tabStops()).toEqual(['Quote']);
    await user.keyboard('{End}');
    expect(within(need).getByRole('button', { name: /^New install:/ })).toHaveFocus();

    // A pressed answer holds the chart's tab stop.
    await user.click(quote);
    expect(tabStops()).toEqual(['Quote']);
    expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
  });

  it('filters by a rating value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rating = screen.getByRole('article', { name: /Overall rating/ });
    await user.click(within(rating).getByRole('button', { name: /^5:/ }));
    expect(rowNames()).toEqual(['Nora Fischer', 'Diego Ruiz']);
    expect(
      screen.getByRole('button', { name: 'Remove filter: Overall rating 5' }),
    ).toBeInTheDocument();
  });

  it('without chartable questions the tiles take one row and the hint mentions tiles', () => {
    const qs = [questions[0]!, questions[5]!];
    const { container } = render(<Harness qs={qs} />);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(container.querySelector('.rsp-sum-top--c0')).not.toBeNull();
    expect(screen.getByText('Click a tile above to filter')).toBeInTheDocument();
    // Name + the long text column only.
    expect(listRegion().querySelector('.rsp-sum-cols')).toHaveTextContent('Anything else?');
  });

  it('groups rows by day with counts', () => {
    render(<Harness />);
    const headings = within(listRegion())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      'Today1, 1 response',
      'Yesterday1, 1 response',
      'Last 7 days1, 1 response',
      // Sep 16 is seven days back.
      'Earlier this month2, 2 responses',
    ]);
    expect(row('Diego Ruiz')).toHaveTextContent('Has files.');
  });

  // Scoped queries: role + name over hundreds of rows is slow in jsdom.
  it('renders 100 rows at a time and shows more on request', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 600 }, (_, i) =>
      sub(`m${i}`, new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(), {
        name: `Person ${600 - i}`,
        need: i % 2 ? 'repair' : 'quote',
      }),
    );
    render(<Harness subs={many} unread={[]} />);
    expect(rowNames()).toHaveLength(SUMMARY_PAGE);
    expect(screen.getByText(`${SUMMARY_PAGE} of 600`)).toBeInTheDocument();

    await user.click(screen.getByText('Show 100 more'));
    expect(rowNames()).toHaveLength(200);
    expect(row('Person 500')).toHaveFocus();

    // A filter starts again from the first page.
    const need = screen.getByRole('article', { name: /What do you need/ });
    await user.click(within(need).getByRole('button', { name: /^Repair: 300 responses/ }));
    expect(rowNames()).toHaveLength(SUMMARY_PAGE);
    expect(count()).toBe('300 of 600');
  }, 15_000);

  it('Escape closes the open row, arrows move between rows', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(row('Kai Nakamura'));
    await user.keyboard('{Escape}');
    expect(row('Kai Nakamura')).toHaveAttribute('aria-expanded', 'false');
    expect(row('Kai Nakamura')).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(row('Ava Park')).toHaveFocus();
    await user.keyboard('{End}');
    expect(row('Diego Ruiz')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(row('Nora Fischer')).toHaveFocus();

    // Escape with filters on (and nothing open) clears them.
    await user.click(screen.getByRole('button', { name: /^Quote:/ }));
    expect(rowNames()).toHaveLength(2);
    await user.keyboard('{Escape}');
    expect(rowNames()).toHaveLength(5);
    expect(screen.getByRole('button', { name: /^Quote:/ })).toHaveFocus();
  });

  it('trash hands off to the page and moves focus to the next row', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(row('Kai Nakamura'));
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(calls.trash).toHaveBeenCalledWith('s2');
    expect(rowNames()).not.toContain('Kai Nakamura');
    expect(row('Ava Park')).toHaveFocus();
  });

  it('Mark all read clears every unread row in this form, with Undo', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Harness unread={['s1', 's2', 'other-form']} />
      </ToastProvider>,
    );
    const all = screen.getByRole('button', { name: 'Mark all read' });
    await user.click(all);
    expect(calls.markRead).toHaveBeenCalledWith(['s1', 's2']);
    // aria-disabled, like the Inbox's: focus stays on the button.
    expect(all).toHaveAttribute('aria-disabled', 'true');
    expect(all).toHaveFocus();
    expect(screen.getByRole('button', { name: /^New: 0 unread/ })).toBeDisabled();
    await user.click(all);
    expect(calls.markRead).toHaveBeenCalledTimes(1);

    // Undo puts both back, oldest first so the list keeps its order.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls.markUnread.mock.calls.map(([id]) => id)).toEqual(['s2', 's1']);
    expect(screen.getByRole('button', { name: /^New: 2 unread/ })).toBeEnabled();
  });

  it('renders respondent text as text, never markup', async () => {
    const user = userEvent.setup();
    const evil = sub('x', at(23, 11), {
      name: '<img src=x onerror="window.__pwned=1">',
      notes: '<b>bold</b>',
    });
    const { container } = render(<Harness subs={[evil]} unread={[]} />);
    await user.click(row('<img src=x onerror="window.__pwned=1">'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getAllByText('<b>bold</b>').length).toBeGreaterThan(0);
  });
});
