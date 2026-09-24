import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxProps, SummaryProps } from '../examples/_admin/responses/types.js';
import type * as SubmissionStore from '../examples/_admin/_submissionStore.js';

const state = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  /** null = use the real (offline, always-ready) store. */
  ready: null as boolean | null,
  ensure: null as null | (() => Promise<void>),
  navigate: vi.fn(),
}));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/_router.js', () => ({ navigate: state.navigate }));
vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
}));
vi.mock('../examples/_admin/_submissionStore.js', async (importOriginal) => {
  const real = await importOriginal<typeof SubmissionStore>();
  return {
    ...real,
    isFormSubmissionsReady: (id: string) =>
      state.ready === null ? real.isFormSubmissionsReady(id) : state.ready,
    ensureFormSubmissions: (id: string, opts?: { force?: boolean }) =>
      state.ensure ? state.ensure() : real.ensureFormSubmissions(id, opts),
  };
});
// The shell's header chrome (bell, sign-out, theme) has its own tests.
vi.mock('../examples/_admin/shell/AdminShell.js', () => ({
  AdminShell: ({
    crumbs,
    rightSlot,
    children,
  }: {
    crumbs: ReactNode;
    rightSlot?: ReactNode;
    children: ReactNode;
  }) => (
    <div data-slate-forms="" data-theme-name="slate">
      <header className="slate-header">
        <div>{crumbs}</div>
        <div>{rightSlot}</div>
      </header>
      <main>{children}</main>
    </div>
  ),
}));
vi.mock('../examples/_admin/components/SharePanel.js', () => ({ SharePanel: () => null }));
// Views are built separately; these stand-ins expose the contract only.
vi.mock('../examples/_admin/responses/ResponsesInbox.js', () => ({
  ResponsesInbox: (p: InboxProps) => (
    <div data-testid={`inbox-${p.mode}`}>
      {p.subs.map((s) => (
        <div key={s.id} data-testid={`row-${s.id}`}>
          {p.unread.has(s.id) ? 'unread ' : ''}
          {s.id}
          <button type="button" onClick={() => p.onTrash(s.id)}>
            trash {s.id}
          </button>
          <button type="button" onClick={() => p.onRestore(s.id)}>
            restore {s.id}
          </button>
          <button type="button" onClick={() => p.onDeleteForever(s.id)}>
            delete {s.id}
          </button>
        </div>
      ))}
      <button type="button" onClick={p.onEmptyTrash}>
        empty trash
      </button>
    </div>
  ),
}));
vi.mock('../examples/_admin/responses/ResponsesSummary.js', () => ({
  ResponsesSummary: (p: SummaryProps) => (
    <div data-testid="summary">{p.subs.length} in summary</div>
  ),
}));

import { FormSubmissions, RESPONSES_VIEW_KEY } from '../examples/_admin/pages/FormSubmissions.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';
import { ToastProvider } from '../examples/_admin/toast.js';
import { listSubmissions, listTrashedSubmissions } from '../examples/_admin/_submissionStore.js';
import { readUnread, setUnread } from '../examples/_admin/responses/unreadStore.js';

const schema = {
  brand: { name: 'Pool' },
  theme: 'editorial',
  questions: [
    { id: 'w', type: 'welcome', title: 'Hi' },
    { id: 'name', type: 'short_text', title: "What's your name?" },
    { id: 't', type: 'thanks', title: 'Done' },
  ],
};

function makeSub(id: string, minutesAgo: number, name: string, trashed = false) {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    formId: 'f1',
    receivedAt: at,
    answers: { name },
    meta: {
      startedAt: at,
      completedAt: at,
      durationMs: 60_000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
    ...(trashed ? { deletedAt: at } : {}),
  };
}

function seed(subs: ReturnType<typeof makeSub>[]) {
  window.localStorage.setItem('slate-submissions', JSON.stringify(subs));
}

function renderPage() {
  return render(
    <ConfirmProvider>
      <ToastProvider>
        <FormSubmissions formId="f1" />
      </ToastProvider>
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  state.form = { id: 'f1', name: 'Pool sign-up', status: 'draft', schema };
  state.ready = null;
  state.ensure = null;
  state.navigate.mockReset();
});

describe('Responses page shell', () => {
  it('opens on Inbox, and the toggle persists across visits', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai')]);
    const first = renderPage();

    expect(screen.getByTestId('inbox-responses')).toBeInTheDocument();
    const toggle = screen.getByRole('group', { name: 'View' });
    expect(within(toggle).getByRole('button', { name: 'Inbox' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(toggle).getByRole('button', { name: 'Summary' }));
    expect(screen.getByTestId('summary')).toHaveTextContent('2 in summary');
    expect(window.localStorage.getItem(RESPONSES_VIEW_KEY)).toBe('summary');
    first.unmount();

    renderPage();
    expect(screen.getByTestId('summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a junk stored view', () => {
    seed([makeSub('s1', 5, 'Nora')]);
    window.localStorage.setItem(RESPONSES_VIEW_KEY, '<script>');
    renderPage();
    expect(screen.getByTestId('inbox-responses')).toBeInTheDocument();
  });

  it('shows the count, the new count and header actions', () => {
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai'), makeSub('s3', 90, 'Ava')]);
    setUnread(['s1', 'other-form-response']);
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Responses' })).toBeInTheDocument();
    expect(screen.getByText('1 new')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Editor' })).toBeInTheDocument();
  });

  it('fits the header trail to the room the studio header leaves', () => {
    seed([makeSub('s1', 5, 'Nora')]);
    // jsdom has no layout: stand in for the brand + crumbs cluster's width.
    const room = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get');
    const header = () => document.querySelector('header') as HTMLElement;
    try {
      room.mockReturnValue(480);
      const wide = renderPage();
      expect(within(header()).getByRole('button', { name: 'Forms' })).toBeInTheDocument();
      expect(within(header()).getByText('Responses')).toBeInTheDocument();
      expect(document.querySelector('.rsp-form-name')).toBeNull();
      wide.unmount();

      room.mockReturnValue(300);
      const mid = renderPage();
      expect(within(header()).queryByRole('button', { name: 'Forms' })).toBeNull();
      expect(within(header()).getByRole('button', { name: 'Pool sign-up' })).toBeInTheDocument();
      expect(document.querySelector('.rsp-form-name')).toBeNull();
      mid.unmount();

      room.mockReturnValue(200);
      renderPage();
      expect(within(header()).queryByRole('button', { name: 'Pool sign-up' })).toBeNull();
      expect(document.querySelector('.rsp-form-name')).toHaveTextContent('Pool sign-up');
    } finally {
      room.mockRestore();
    }
  });

  it('enters and leaves trash mode, keeping focus on the swapped control', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai', true)]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Trash, 1 response' }));
    expect(screen.getByTestId('inbox-trash')).toHaveTextContent('s2');
    expect(screen.getByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
    const back = screen.getByRole('button', { name: 'Responses' });
    expect(back).toHaveFocus();

    await user.click(back);
    expect(screen.getByTestId('inbox-responses')).toHaveTextContent('s1');
    expect(screen.getByRole('button', { name: 'Trash, 1 response' })).toHaveFocus();
  });

  it('trashes at once and restores from the Undo toast, unread state included', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai')]);
    setUnread(['s2']);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'trash s2' }));
    expect(listTrashedSubmissions('f1').map((s) => s.id)).toEqual(['s2']);
    expect(screen.queryByTestId('row-s2')).not.toBeInTheDocument();
    expect(readUnread()).toEqual([]);
    const toast = screen.getByText('Moved to trash').closest('.slate-toast') as HTMLElement;
    expect(toast).toHaveTextContent('Kai');

    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(
      listSubmissions('f1')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['s1', 's2']);
    expect(screen.getByTestId('row-s2')).toHaveTextContent('unread');
    expect(screen.queryByText('Moved to trash')).not.toBeInTheDocument();
  });

  it('asks before deleting forever and says "permanently"', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai', true)]);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Trash, 1 response' }));

    await user.click(screen.getByRole('button', { name: 'delete s2' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('permanently');
    expect(dialog).not.toHaveTextContent('localStorage');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(listTrashedSubmissions('f1')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'empty trash' }));
    const again = screen.getByRole('alertdialog');
    expect(again).toHaveTextContent('Delete 1 response forever?');
    await user.click(within(again).getByRole('button', { name: 'Empty trash' }));
    expect(listTrashedSubmissions('f1')).toHaveLength(0);
    expect(screen.getByText('Trash is empty')).toBeInTheDocument();
  });

  it('empty states: draft, published, and only-trash', () => {
    const draft = renderPage();
    expect(screen.getByText('No responses yet')).toBeInTheDocument();
    expect(
      screen.getByText('Publish from Share to get a public fill link, then send it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish & share' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    draft.unmount();

    state.form = { ...state.form, status: 'published' };
    const published = renderPage();
    expect(
      screen.getByText(
        'Share your public link. New answers appear here as soon as someone submits.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share link' })).toBeInTheDocument();
    published.unmount();

    seed([makeSub('s1', 5, 'Nora', true)]);
    renderPage();
    expect(screen.getByText('Inbox is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open trash' })).toBeInTheDocument();
  });

  it('shows a skeleton while a form loads, then the view', async () => {
    let finish: () => void = () => {};
    state.ready = false;
    state.ensure = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    seed([makeSub('s1', 5, 'Nora')]);
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading responses' })).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-responses')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Responses' })).toBeInTheDocument();

    state.ready = true;
    await act(async () => finish());
    expect(screen.queryByRole('status', { name: 'Loading responses' })).not.toBeInTheDocument();
    expect(screen.getByTestId('inbox-responses')).toBeInTheDocument();
  });

  it('offers Try again when loading fails', async () => {
    const user = userEvent.setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.ready = false;
    const ensure = vi.fn(() => Promise.reject(new Error('offline')));
    state.ensure = ensure;
    renderPage();
    expect(
      await screen.findByText('Couldn’t load responses. Check your connection and try again.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(ensure).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('the ⋯ menu works from the keyboard', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora')]);
    renderPage();

    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Preview form', 'Move all to trash']);
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Move all to trash' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Move to trash' }),
    );
    expect(listSubmissions('f1')).toHaveLength(0);
  });
});
