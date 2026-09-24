import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question } from '@/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import type { InboxProps } from '../examples/_admin/responses/types.js';
import type * as Hooks from '../examples/_admin/responses/hooks.js';

const env = vi.hoisted(() => ({ phone: false }));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/responses/hooks.js', async (importOriginal) => {
  const real = await importOriginal<typeof Hooks>();
  return { ...real, usePhone: () => env.phone };
});

import { ResponsesInbox } from '../examples/_admin/responses/ResponsesInbox.js';
import { ToastProvider } from '../examples/_admin/toast.js';

const questions: Question[] = [
  { id: 'name', type: 'short_text', title: "What's your name?" },
  { id: 'email', type: 'email', title: 'Best email to reach you' },
  {
    id: 'service',
    type: 'single_choice',
    title: 'What do you need?',
    options: [
      { label: 'Quote', value: 'quote' },
      { label: 'Repair', value: 'repair' },
    ],
  },
  { id: 'notes', type: 'long_text', title: 'Anything else we should know?' },
];

function makeSub(
  id: string,
  minutesAgo: number,
  answers: Record<string, unknown>,
  extra: Partial<StoredSubmission> = {},
): StoredSubmission {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    formId: 'f1',
    receivedAt: at,
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: at,
      completedAt: at,
      durationMs: 79_000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
    ...extra,
  };
}

/** Newest first, like the page passes them. */
const pool = (): StoredSubmission[] => [
  makeSub('s1', 2, {
    name: 'Harper Quinn',
    email: 'harper@example.com',
    service: 'repair',
    notes: 'Pump is making a grinding noise. Gate code is 4412.',
  }),
  makeSub('s2', 60, {
    name: 'Priya Shah',
    email: 'priya@example.com',
    service: 'quote',
    notes: 'Small plunge pool.',
  }),
  makeSub('s3', 300, { name: 'Omar Haddad', email: 'not an email?cc=x@y.z', service: 'repair' }),
  makeSub('s4', 3000, { name: 'Grace Cho', email: 'grace@example.com', service: 'quote' }),
];

type Spies = {
  onMarkRead: Mock<(ids: string[]) => void>;
  onMarkUnread: Mock<(id: string) => void>;
  onTrash: Mock<(id: string) => void>;
  onRestore: Mock<(id: string) => void>;
  onDeleteForever: Mock<(id: string) => void>;
  onRestoreAll: Mock<() => void>;
  onEmptyTrash: Mock<() => void>;
};

let spies: Spies;
let setSubsOutside: ((subs: StoredSubmission[]) => void) | null = null;

/** Plays the page's part: keeps the unread set and the list in state. */
function Harness({
  initialSubs,
  initialUnread,
  mode = 'responses',
}: {
  initialSubs: StoredSubmission[];
  initialUnread: string[];
  mode?: InboxProps['mode'];
}) {
  const [subs, setSubs] = useState(initialSubs);
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set(initialUnread));
  setSubsOutside = setSubs;
  const onMarkRead = useCallback((ids: string[]) => {
    spies.onMarkRead(ids);
    setUnread((u) => {
      const next = new Set(u);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);
  const onMarkUnread = useCallback((id: string) => {
    spies.onMarkUnread(id);
    setUnread((u) => new Set(u).add(id));
  }, []);
  return (
    <ToastProvider>
      <div data-slate-forms="" data-theme-name="slate">
        <div className="slate-rsp">
          <ResponsesInbox
            formId="f1"
            formName="Pool & Spa sign-up"
            questions={questions}
            subs={subs}
            unread={unread}
            mode={mode}
            onMarkRead={onMarkRead}
            onMarkUnread={onMarkUnread}
            onTrash={spies.onTrash}
            onRestore={spies.onRestore}
            onDeleteForever={spies.onDeleteForever}
            onRestoreAll={spies.onRestoreAll}
            onEmptyTrash={spies.onEmptyTrash}
          />
        </div>
      </div>
    </ToastProvider>
  );
}

function renderInbox(
  opts: { subs?: StoredSubmission[]; unread?: string[]; mode?: InboxProps['mode'] } = {},
) {
  return render(
    <Harness
      initialSubs={opts.subs ?? pool()}
      initialUnread={opts.unread ?? ['s1', 's2']}
      mode={opts.mode}
    />,
  );
}

const row = (name: string) => {
  const list = screen.getByRole('region', { name: /list/i });
  return within(list)
    .getAllByRole('button')
    .find((b) => b.classList.contains('rsp-ib-row') && b.textContent?.includes(name));
};

const readerTitle = () => screen.queryByRole('heading', { level: 2 })?.textContent ?? null;

beforeEach(() => {
  env.phone = false;
  spies = {
    onMarkRead: vi.fn<(ids: string[]) => void>(),
    onMarkUnread: vi.fn<(id: string) => void>(),
    onTrash: vi.fn<(id: string) => void>(),
    onRestore: vi.fn<(id: string) => void>(),
    onDeleteForever: vi.fn<(id: string) => void>(),
    onRestoreAll: vi.fn<() => void>(),
    onEmptyTrash: vi.fn<() => void>(),
  };
});

afterEach(() => {
  setSubsOutside = null;
});

describe('Inbox view', () => {
  it('lists responses by day and opens one, marking it read', async () => {
    const user = userEvent.setup();
    renderInbox();

    // Nothing open: the reader lists what's unread.
    expect(readerTitle()).toBe('2 unread responses');
    expect(screen.getByRole('list', { name: /Today/ })).toBeInTheDocument();

    await user.click(row('Priya Shah')!);
    expect(spies.onMarkRead).toHaveBeenCalledWith(['s2']);
    expect(readerTitle()).toBe('Priya Shah');
    expect(row('Priya Shah')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('2 of 4')).toBeInTheDocument();

    // Opening one that is already read doesn't write again.
    spies.onMarkRead.mockClear();
    await user.click(row('Grace Cho')!);
    expect(spies.onMarkRead).not.toHaveBeenCalled();
    expect(readerTitle()).toBe('Grace Cho');
  });

  it('shows "All caught up" when nothing is unread', () => {
    renderInbox({ unread: [] });
    expect(readerTitle()).toBe('Nothing unread');
    expect(screen.getByText(/4 responses in total/)).toBeInTheDocument();
  });

  it('opens an unread card from the digest', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(screen.getByRole('button', { name: /Read newest/ }));
    expect(readerTitle()).toBe('Harper Quinn');
    expect(spies.onMarkRead).toHaveBeenCalledWith(['s1']);
  });

  it('moves with j / k, opens with Enter, closes with Escape and toggles read with u', async () => {
    const user = userEvent.setup();
    renderInbox({ unread: ['s2'] });

    // j with nothing open starts at the first unread response.
    await user.keyboard('j');
    expect(readerTitle()).toBe('Priya Shah');
    await user.keyboard('j');
    expect(readerTitle()).toBe('Omar Haddad');
    await user.keyboard('k');
    expect(readerTitle()).toBe('Priya Shah');
    await user.keyboard('{ArrowDown}'); // arrows only act from the list
    expect(readerTitle()).toBe('Priya Shah');

    await user.keyboard('u');
    expect(spies.onMarkUnread).toHaveBeenCalledWith('s2');
    expect(screen.getByRole('button', { name: /Mark read/ })).toBeInTheDocument();
    await user.keyboard('u');
    expect(spies.onMarkRead).toHaveBeenLastCalledWith(['s2']);

    // Escape closes; focus lands on the row that was open.
    await user.keyboard('{Escape}');
    expect(readerTitle()).toBe('Nothing unread');
    expect(row('Priya Shah')).toHaveFocus();

    // From the row, arrows move and focus follows.
    await user.keyboard('{ArrowDown}');
    expect(readerTitle()).toBe('Omar Haddad');
    expect(row('Omar Haddad')).toHaveFocus();

    // Enter on a row opens it (native button); from the page it opens the last one.
    await user.keyboard('{Escape}');
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Enter}');
    expect(readerTitle()).toBe('Omar Haddad');
  });

  it('ignores single-key shortcuts while typing in search', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.keyboard('/');
    const search = screen.getByRole('searchbox', { name: 'Search responses' });
    expect(search).toHaveFocus();

    await user.keyboard('jku');
    expect(search).toHaveValue('jku');
    expect(readerTitle()).toBe('2 unread responses');
    expect(spies.onMarkRead).not.toHaveBeenCalled();

    // Escape clears first, then leaves the box for the list.
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(search).not.toHaveFocus();
  });

  it('searches names, emails and answers; empty results offer Clear search', async () => {
    const user = userEvent.setup();
    renderInbox();
    const search = screen.getByRole('searchbox', { name: 'Search responses' });

    await user.type(search, 'gate');
    expect(row('Harper Quinn')).toBeDefined();
    expect(row('Priya Shah')).toBeUndefined();
    expect(document.querySelector('.rsp-ib-list [role="status"]')).toHaveTextContent(
      '1 response matches “gate”',
    );
    // The hit is highlighted as text, not markup.
    expect(document.querySelector('mark.rsp-mark')?.textContent?.toLowerCase()).toBe('gate');

    // Enter in the search box opens the first match.
    await user.keyboard('{Enter}');
    expect(readerTitle()).toBe('Harper Quinn');

    await user.clear(search);
    await user.type(search, 'priya@example');
    expect(row('Priya Shah')).toBeDefined();
    expect(row('Harper Quinn')).toBeUndefined();

    await user.clear(search);
    await user.type(search, 'zzzq');
    expect(screen.getByText('No responses match “zzzq”')).toBeInTheDocument();
    // The empty state's button (the × in the box has the same name).
    await user.click(screen.getByText('Clear search', { selector: 'button' }));
    expect(search).toHaveValue('');
    expect(row('Grace Cho')).toBeDefined();
  });

  it('filters to unread, keeps an opened row visible, and shows the caught-up state', async () => {
    const user = userEvent.setup();
    renderInbox();
    const show = screen.getByRole('group', { name: 'Show' });

    await user.click(within(show).getByRole('button', { name: /^Unread/ }));
    expect(within(show).getByRole('button', { name: /^Unread/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(row('Grace Cho')).toBeUndefined();

    await user.click(row('Harper Quinn')!);
    // Read now, but it stays in the Unread list until the filter changes.
    expect(row('Harper Quinn')).toBeDefined();
    expect(row('Harper Quinn')).not.toHaveClass('rsp-ib-row--unread');

    await user.click(screen.getByRole('button', { name: /Mark all read/ }));
    expect(spies.onMarkRead).toHaveBeenLastCalledWith(['s2']);
    expect(screen.getByText('You’re all caught up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark all read/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Show all responses' }));
    expect(row('Grace Cho')).toBeDefined();
  });

  it('labels the reader like the Summary does and announces read changes', async () => {
    const user = userEvent.setup();
    const anon = makeSub('s5', 6000, { service: 'quote', notes: 'No name here.' });
    renderInbox({ subs: [...pool(), anon], unread: [] });

    await user.click(row('Priya Shah')!);
    expect(screen.getByText('Response #4')).toBeInTheDocument();
    expect(screen.getByText('Time to complete')).toBeInTheDocument();

    await user.keyboard('u');
    expect(screen.getByText('Priya Shah marked as unread.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Mark read/ }));
    expect(spies.onMarkRead).toHaveBeenLastCalledWith(['s2']);
    expect(screen.getByText('Priya Shah marked as read.')).toBeInTheDocument();

    // No name or email: the title is the number, so the label says so.
    await user.click(row('Response #1')!);
    expect(readerTitle()).toBe('Response #1');
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
  });

  it('offers Reply only for a safe address, with an encoded subject', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(row('Harper Quinn')!);
    const reply = screen.getByRole('link', { name: /Reply/ });
    expect(reply).toHaveAttribute(
      'href',
      `mailto:harper@example.com?subject=${encodeURIComponent('Re: Pool & Spa sign-up')}`,
    );
    expect(reply).toHaveTextContent('Reply to Harper');

    await user.click(row('Omar Haddad')!);
    expect(screen.queryByRole('link', { name: /Reply/ })).toBeNull();
    // The unsafe answer still shows as plain text in the answers.
    expect(screen.getByText('not an email?cc=x@y.z')).toBeInTheDocument();
  });

  it('trashes from the reader and moves on to the next response', async () => {
    const user = userEvent.setup();
    renderInbox({ unread: [] });

    await user.click(row('Priya Shah')!);
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(spies.onTrash).toHaveBeenCalledWith('s2');

    // The page removes it from the list; the reader shows its older neighbour.
    act(() => setSubsOutside?.(pool().filter((s) => s.id !== 's2')));
    expect(readerTitle()).toBe('Omar Haddad');
  });

  it('trash mode: Restore, Delete forever, Restore all and Empty trash call back', async () => {
    const user = userEvent.setup();
    const deleted = new Date(Date.now() - 2 * 3_600_000).toISOString();
    renderInbox({
      mode: 'trash',
      unread: [],
      subs: pool()
        .slice(0, 2)
        .map((s) => ({ ...s, deletedAt: deleted })),
    });

    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
    expect(readerTitle()).toBe('2 deleted responses');

    await user.click(screen.getByRole('button', { name: /Restore all/ }));
    expect(spies.onRestoreAll).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Empty trash/ }));
    expect(spies.onEmptyTrash).toHaveBeenCalled();

    await user.click(row('Priya Shah')!);
    expect(spies.onMarkRead).not.toHaveBeenCalled();
    expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark unread/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(spies.onRestore).toHaveBeenCalledWith('s2');
    await user.click(screen.getByRole('button', { name: /Delete forever/ }));
    expect(spies.onDeleteForever).toHaveBeenCalledWith('s2');

    // u does nothing in trash.
    await user.keyboard('u');
    expect(spies.onMarkUnread).not.toHaveBeenCalled();
  });

  it('renders big lists in steps and j/k keep going past the rendered rows', async () => {
    const user = userEvent.setup({ delay: null });
    const subs = Array.from({ length: 600 }, (_, i) =>
      makeSub(`b${i}`, i * 30 + 1, { name: `Person ${i}`, service: 'quote' }),
    );
    renderInbox({ subs, unread: [] });

    const rows = () => document.querySelectorAll('.rsp-ib-row').length;
    expect(rows()).toBe(150);
    expect(screen.getByRole('button', { name: 'Show 150 more' })).toBeInTheDocument();

    await user.keyboard('j'.repeat(160));
    expect(readerTitle()).toBe('Person 159');
    expect(rows()).toBe(300);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('Person 159');
    expect(screen.getByText('160 of 600')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 150 more' }));
    expect(rows()).toBe(450);

    // Filtering starts again from one step.
    await user.type(screen.getByRole('searchbox', { name: 'Search responses' }), 'person');
    expect(rows()).toBe(150);
  }, 30_000);
});

describe('Inbox view on phones', () => {
  beforeEach(() => {
    env.phone = true;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a response full width and goes back to the same row', async () => {
    const user = userEvent.setup();
    renderInbox();

    // No digest beside the list on phones.
    expect(readerTitle()).toBeNull();
    await user.click(row('Priya Shah')!);

    expect(screen.queryByRole('region', { name: /list/i })).toBeNull();
    expect(readerTitle()).toBe('Priya Shah');
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /All responses/ }));
    expect(readerTitle()).toBeNull();
    expect(row('Priya Shah')).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalled();
  });
});
