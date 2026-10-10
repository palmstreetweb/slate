/**
 * Audit fixes (2026-10-09), studio: the Responses page.
 *  - A4: a full slot says how far over it ends up, with the right plural.
 *  - B7: after a reload shows the form's answers incomplete, the page loads
 *    them again instead of sitting on its skeleton.
 *  - B13: Export CSV isn't offered in Trash (it exports the inbox's rows), and
 *    "Move all to trash" marks read what it trashes, not what was counted.
 */

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxProps, SummaryProps } from '../examples/_admin/responses/types.js';
import type * as SubmissionStore from '../examples/_admin/_submissionStore.js';
import type * as Router from '../examples/_admin/_router.js';

const state = vi.hoisted(() => ({
  form: null as Record<string, unknown> | null,
  ready: null as boolean | null,
  ensureCalls: [] as Array<{ force?: boolean }>,
  move: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/_router.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: state.navigate,
}));
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
    ensureFormSubmissions: (id: string, opts?: { force?: boolean }) => {
      state.ensureCalls.push(opts ?? {});
      return real.ensureFormSubmissions(id, opts);
    },
  };
});
vi.mock('../examples/_admin/signupMove.js', () => ({
  moveSignupSlot: (args: unknown) => state.move(args),
}));
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
vi.mock('../examples/_admin/responses/ResponsesInbox.js', () => ({
  ResponsesInbox: (p: InboxProps) => (
    <div data-testid={`inbox-${p.mode}`}>
      {p.subs.map((s) => (
        <div key={s.id} data-testid={`row-${s.id}`}>
          {s.id}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('../examples/_admin/responses/ResponsesSummary.js', () => ({
  ResponsesSummary: (p: SummaryProps) => (
    <div data-testid="summary">
      <button
        type="button"
        onClick={() =>
          p.onMoveSignup?.({
            sub: p.subs[0]!,
            question: { id: 'slot', type: 'signup', title: 'When?', slots: [] } as never,
            from: 'afternoon',
            to: 'morning',
            toName: 'Morning',
            capacity: 1,
          })
        }
      >
        move first to Morning
      </button>
    </div>
  ),
}));

import { FormSubmissions } from '../examples/_admin/pages/FormSubmissions.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';
import { ToastProvider } from '../examples/_admin/toast.js';
import { addSubmission, trashSubmission } from '../examples/_admin/_submissionStore.js';
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

const meta = () => {
  const now = new Date();
  return {
    startedAt: now,
    completedAt: now,
    durationMs: 1000,
    questionsVisited: [],
    hiddenFields: {},
    score: 0,
  } as unknown as Parameters<typeof addSubmission>[2];
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('slate-responses-view', 'inbox');
  state.form = { id: 'f1', name: 'Pool sign-up', status: 'draft', schema };
  state.ready = null;
  state.ensureCalls = [];
  state.move.mockReset();
  state.navigate.mockReset();
});

describe('a full slot (audit A4)', () => {
  it('says how far over the slot ends up, and "spot is" for one', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Cara')]);
    state.move.mockResolvedValueOnce({ ok: false, reason: 'full', taken: 2, capacity: 1 });
    state.move.mockResolvedValueOnce({ ok: true });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Summary' }));
    await user.click(screen.getByRole('button', { name: 'move first to Morning' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('All 1 spot is taken.');
    expect(dialog.textContent).toContain('The slot will be over by 2.');
    await user.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(state.move).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
  });

  it('still says "over by one" when one person tips a slot of several', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Cara')]);
    state.move.mockResolvedValueOnce({ ok: false, reason: 'full', taken: 4, capacity: 4 });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Summary' }));
    await user.click(screen.getByRole('button', { name: 'move first to Morning' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('All 4 spots are taken.');
    expect(dialog.textContent).toContain('The slot will be over by one.');
  });
});

describe('answers found incomplete after a reload (audit B7)', () => {
  it('loads the form again instead of staying on the skeleton', async () => {
    seed([makeSub('s1', 5, 'Nora')]);
    state.ready = true;
    renderPage();
    expect(screen.getByTestId('inbox-responses')).toBeInTheDocument();
    expect(state.ensureCalls).toHaveLength(1);

    // A reload elsewhere un-marks the form as loaded, then the store notifies.
    state.ready = false;
    await act(async () => {
      addSubmission('f1', { name: 'Kai' }, meta());
    });
    await act(async () => {
      // The load the page asked for lands: the store reports ready again.
      state.ready = true;
      addSubmission('f1', { name: 'Ava' }, meta());
    });
    expect(state.ensureCalls.length).toBeGreaterThanOrEqual(2);
    expect(state.ensureCalls[1]).toEqual({ force: true });
    expect(screen.getByTestId('inbox-responses')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading responses' })).toBeNull();
  });

  it('does not load twice on an ordinary open', async () => {
    seed([makeSub('s1', 5, 'Nora')]);
    state.ready = true;
    renderPage();
    await act(async () => {
      addSubmission('f1', { name: 'Kai' }, meta());
    });
    expect(state.ensureCalls).toHaveLength(1);
  });
});

describe('Trash view and bulk actions (audit B13)', () => {
  it('offers Export CSV in the inbox, not in Trash', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai', true)]);
    renderPage();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trash, 1 response' }));
    expect(screen.getByTestId('inbox-trash')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });

  it('"Move all to trash" marks read what it trashes, including a row that arrived meanwhile', async () => {
    const user = userEvent.setup();
    seed([makeSub('s1', 5, 'Nora'), makeSub('s2', 50, 'Kai')]);
    setUnread(['s1', 's2']);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move all to trash' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Move 2 responses to trash?');
    // One more arrives while the dialog is open; one is trashed elsewhere.
    let fresh = '';
    await act(async () => {
      fresh = addSubmission('f1', { name: 'Ava' }, meta()).id;
      setUnread([fresh, 's1', 's2']);
      trashSubmission('s2');
    });
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(readUnread()).toEqual(['s2']);
    expect(screen.queryByTestId('row-s1')).toBeNull();
    expect(screen.queryByTestId(`row-${fresh}`)).toBeNull();
  });
});
