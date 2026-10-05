/**
 * Dashboard words (S21, COPY-16): deleting forever, emptying Trash and the
 * damaged-data banner say what happens in plain words, never "localStorage".
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../examples/_admin/shell/AdminShell.js', () => ({
  AdminShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));

const ai = vi.hoisted(() => ({ onReady: null as null | ((draft: unknown) => Promise<void>) }));
// Build with AI shows whatever saving the draft throws: capture the hand-off.
vi.mock('../examples/_admin/components/BuildWithAiModal.js', () => ({
  BuildWithAiModal: ({ onReady }: { onReady: (draft: unknown) => Promise<void> }) => {
    ai.onReady = onReady;
    return null;
  },
  SparkleIcon: () => null,
}));

const { Dashboard } = await import('../examples/_admin/pages/Dashboard.js');
const { ConfirmProvider } = await import('../examples/_admin/_confirm.js');

function trashed(id: string, name: string) {
  return {
    id,
    name,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: '2026-10-02T00:00:00.000Z',
    schema: { brand: { name }, theme: 'swiss', themeMode: 'toggle', questions: [] },
  };
}

function show() {
  render(
    <ConfirmProvider>
      <Dashboard />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('Dashboard words', () => {
  it('Delete forever says the form and its responses go for good', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('slate-forms', JSON.stringify([trashed('f_1', 'Beta')]));
    show();
    await user.click(screen.getByRole('tab', { name: /Trash/ }));
    await user.click(screen.getByRole('button', { name: 'Delete forever' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete "Beta" forever?');
    expect(dialog.textContent).toContain(
      'The form and all its responses are deleted for good. This can’t be undone.',
    );
    expect(dialog.textContent).not.toMatch(/localStorage/);
  });

  it('Empty trash counts right and speaks plainly', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'slate-forms',
      JSON.stringify([trashed('f_1', 'Beta'), trashed('f_2', 'Gamma')]),
    );
    show();
    await user.click(screen.getByRole('tab', { name: /Trash/ }));
    await user.click(screen.getByRole('button', { name: 'Empty trash' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Delete 2 forms forever?');
    expect(dialog.textContent).toContain(
      'These forms and their responses are deleted for good. This can’t be undone.',
    );
    expect(dialog.textContent).not.toMatch(/localStorage/);
  });

  it('an AI draft that can’t be saved gets a plain sentence, not the error', async () => {
    show();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException(
        'QuotaExceededError: the quota has been exceeded',
        'QuotaExceededError',
      );
    });
    const draft = {
      name: 'Quote',
      schema: { brand: { name: 'Quote' }, theme: 'swiss', themeMode: 'toggle', questions: [] },
      form: {},
    };
    await expect(ai.onReady!(draft)).rejects.toThrow(
      'Couldn’t save the draft. Check your connection and try again.',
    );
    setItem.mockRestore();
  });

  it('damaged saved data is described without developer words', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('slate-forms', '{not json');
    show();
    const alert = screen.getAllByRole('alert')[0]!;
    expect(alert.textContent).toContain('Some saved data in this browser can’t be read');
    expect(alert.textContent).toContain('Your saved forms look damaged.');
    expect(alert.textContent).not.toMatch(/localStorage|corrupted|storage/);
    await user.click(within(alert).getByRole('button', { name: 'Reset saved data' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Reset this browser’s saved data?');
    expect(dialog.textContent).toContain(
      'Deletes every form saved in this browser. This can’t be undone.',
    );
  });
});
