/**
 * Studio dialogs and Settings (QA pass, 2026-10-04):
 * - a confirm or the title prompt belongs to the page it opened on: Back or a
 *   link cancels it and gives the page its scroll back, so "Move to trash" can
 *   never act on a page that's gone (SCROLL-7);
 * - a dialog opened over Settings (Backup import) keeps Settings open when it's
 *   pressed, and Esc closes only the dialog (X-1);
 * - the Feedback dialog takes focus and closes on Esc (SCROLL-11);
 * - Backup speaks plain words.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as DataBackup from '../examples/_admin/dataBackup.js';

const state = vi.hoisted(() => ({ pick: null as string | null }));

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/neon/ensureAuth.js', () => ({ ensureAuthForDataApi: vi.fn() }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../examples/_admin/neon/AuthProvider.js', () => ({
  useAuth: () => ({ user: null, signOut: vi.fn(async () => ({ error: null })) }),
}));
// The bell has its own tests; here it only has to sit in the bar.
vi.mock('../examples/_admin/shell/StudioInbox.js', () => ({
  StudioInbox: () => <button type="button">Notifications</button>,
}));
vi.mock('../examples/_admin/dataBackup.js', async (importOriginal) => ({
  ...(await importOriginal<typeof DataBackup>()),
  pickBackupFile: vi.fn(async () => state.pick),
}));

import { navigate } from '../examples/_admin/_router.js';
import { ConfirmProvider, useConfirm } from '../examples/_admin/_confirm.js';
import { PromptFormTitleProvider, usePromptFormTitle } from '../examples/_admin/promptFormTitle.js';
import { Settings } from '../examples/_admin/pages/Settings.js';
import { FeedbackButton } from '../examples/_admin/shell/FeedbackButton.js';

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  state.pick = null;
});

afterEach(() => {
  document.documentElement.style.overflow = '';
});

/** Browser Back: the address changes, then popstate. */
function goBackTo(path: string) {
  act(() => {
    window.history.replaceState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

function Asker({
  onAnswer,
  title = 'Move “Intake” to trash?',
}: {
  onAnswer: (v: boolean) => void;
  title?: string;
}) {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm({ title, danger: true }).then(onAnswer)}>
      Ask
    </button>
  );
}

describe('confirm dialog follows the page (SCROLL-7)', () => {
  it('a link while it is open cancels it and gives the scroll back', async () => {
    const user = userEvent.setup();
    const answers: boolean[] = [];
    render(
      <ConfirmProvider>
        <Asker onAnswer={(v) => answers.push(v)} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Move “Intake” to trash?');
    expect(document.documentElement.style.overflow).toBe('hidden');

    act(() => navigate('/settings'));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(answers).toEqual([false]);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('Back while it is open cancels it too', async () => {
    const user = userEvent.setup();
    const answers: boolean[] = [];
    window.history.replaceState({}, '', '/forms/f1/edit');
    render(
      <ConfirmProvider>
        <Asker onAnswer={(v) => answers.push(v)} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    goBackTo('/settings');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(answers).toEqual([false]);
  });

  it('a page that navigates and then asks keeps its dialog', async () => {
    const user = userEvent.setup();
    function GoThenAsk() {
      const confirm = useConfirm();
      return (
        <button
          type="button"
          onClick={() => {
            navigate('/forms/f1/edit');
            void confirm({ title: 'Undo generated draft?' });
          }}
        >
          Go
        </button>
      );
    }
    render(
      <ConfirmProvider>
        <GoThenAsk />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Undo generated draft?');
    await act(async () => {});
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('staying on the page keeps it open, and the answer still counts', async () => {
    const user = userEvent.setup();
    const answers: boolean[] = [];
    render(
      <ConfirmProvider>
        <Asker onAnswer={(v) => answers.push(v)} />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    // Same page, nothing changes: still open.
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm' }),
    );
    expect(answers).toEqual([true]);
  });

  it('a newer question cancels an unanswered one instead of leaving it hanging', async () => {
    const answers: string[] = [];
    let ask: ReturnType<typeof useConfirm> | null = null;
    function Grab() {
      ask = useConfirm();
      return null;
    }
    render(
      <ConfirmProvider>
        <Grab />
      </ConfirmProvider>,
    );
    await act(async () => {
      void ask!({ title: 'First?' }).then((v) => answers.push(`first:${v}`));
    });
    await act(async () => {
      void ask!({ title: 'Second?' }).then((v) => answers.push(`second:${v}`));
    });
    expect(answers).toEqual(['first:false']);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Second?');
  });
});

describe('title prompt follows the page (SCROLL-7)', () => {
  it('leaving the page cancels it (no share) and gives the scroll back', async () => {
    const user = userEvent.setup();
    const answers: Array<string | null> = [];
    function Sharer() {
      const prompt = usePromptFormTitle();
      return (
        <button type="button" onClick={() => void prompt().then((v) => answers.push(v))}>
          Share
        </button>
      );
    }
    window.history.replaceState({}, '', '/forms/f1/edit');
    render(
      <PromptFormTitleProvider>
        <Sharer />
      </PromptFormTitleProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Give your form a title' })).toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('hidden');

    goBackTo('/');

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Give your form a title' }),
      ).not.toBeInTheDocument(),
    );
    expect(answers).toEqual([null]);
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('dialogs over Settings (X-1)', () => {
  function renderSettings() {
    window.history.replaceState({}, '', '/settings');
    return render(
      <ConfirmProvider>
        <Settings />
      </ConfirmProvider>,
    );
  }

  it('pressing OK on "That isn’t a Slate backup" keeps Settings open', async () => {
    const user = userEvent.setup();
    renderSettings();
    state.pick = '{"hello":"world"}';
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('That isn’t a Slate backup');
    expect(dialog).toHaveTextContent('Choose a file you saved with Export backup.');

    await user.click(within(dialog).getByRole('button', { name: 'OK' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings');
  });

  it('"Import backup?" survives a press, so Import really imports', async () => {
    const user = userEvent.setup();
    renderSettings();
    state.pick = JSON.stringify({
      v: 1,
      exportedAt: '2026-10-01T10:00:00.000Z',
      forms: [{ id: 'f1', name: 'Intake', schema: { questions: [] } }],
      submissions: [
        { id: 's1', formId: 'f1', answers: {}, receivedAt: '2026-10-01T10:00:00.000Z' },
        { id: 's2', formId: 'f1', answers: {}, receivedAt: '2026-10-01T10:00:00.000Z' },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      /replaces every form and response in this browser with the 1 form and 2 responses in the backup from/,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(window.location.pathname).toBe('/settings');
    const stats = document.querySelectorAll('.slate-settings-stats dd');
    expect([...stats].map((d) => d.textContent)).toEqual(['1', '2']);
  });

  it('Esc closes only the dialog; the next Esc closes Settings', async () => {
    const user = userEvent.setup();
    renderSettings();
    state.pick = 'not a backup';
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    await screen.findByRole('alertdialog');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings');

    await user.keyboard('{Escape}');
    expect(window.location.pathname).toBe('/');
  });

  it('a press on the page around Settings still closes it', () => {
    renderSettings();
    fireEvent.pointerDown(document.querySelector('main.slate-content')!);
    expect(window.location.pathname).toBe('/');
  });

  it('a press on something portaled over the page (a toast) does not', () => {
    renderSettings();
    const toast = document.createElement('div');
    document.body.append(toast);
    fireEvent.pointerDown(toast);
    expect(window.location.pathname).toBe('/settings');
    toast.remove();
  });

  it('says "Signed in." rather than "Signed in as unknown" (cloud copy lives in the source)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../examples/_admin/pages/Settings.tsx'), 'utf8');
    expect(src).not.toMatch(/'unknown'/);
    expect(src).toMatch(/'Signed in\.'/);
  });
});

describe('Feedback dialog (SCROLL-11)', () => {
  // jsdom has no layout, so offsetParent is always null and the focus trap
  // would see nothing focusable. Browsers give rendered elements one.
  const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.parentElement;
      },
    });
  });
  afterEach(() => {
    if (realOffsetParent) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
    }
  });

  it('takes focus, keeps it while typing, and closes on Esc', async () => {
    const user = userEvent.setup();
    render(<FeedbackButton />);
    const fab = screen.getByRole('button', { name: 'Send feedback' });
    await user.click(fab);

    const dialog = screen.getByRole('dialog', { name: 'Send feedback' });
    const box = within(dialog).getByRole('textbox');
    expect(document.activeElement).toBe(box);
    expect(document.documentElement.style.overflow).toBe('hidden');

    await user.type(box, 'Love it');
    expect(box).toHaveValue('Love it');
    expect(document.activeElement).toBe(box);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Send feedback' })).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(fab);
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<FeedbackButton />);
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    const dialog = screen.getByRole('dialog', { name: 'Send feedback' });
    await user.type(within(dialog).getByRole('textbox'), 'x');
    // textarea → Cancel → Send → back to the textarea
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Send' }));
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox'));
  });
});

describe('Backup copy is plain words', () => {
  it('never says localStorage or JSON to the owner', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../examples/_admin/components/BackupPanel.tsx'),
      'utf8',
    );
    const strings = [...src.matchAll(/'([^']*)'|`([^`]*)`|>([^<>{}]+)</g)]
      .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
      .filter((s) => /\s/.test(s));
    for (const s of strings) {
      expect(s).not.toMatch(/localStorage|JSON|\(s\)/);
    }
  });
});
