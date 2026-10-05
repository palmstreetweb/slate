/**
 * Backup (local mode): plain words (COPY-16), and an imported form never
 * wears the studio's own theme (F31).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  raw: '' as string,
  replaceAllForms: vi.fn(),
  replaceAllSubmissions: vi.fn(),
}));

vi.mock('../examples/_admin/dataBackup.js', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  pickBackupFile: () => Promise.resolve(state.raw),
}));
vi.mock('../examples/_admin/_formsStore.js', () => ({
  listAllForms: () => [],
  replaceAllForms: (forms: unknown) => state.replaceAllForms(forms),
}));
vi.mock('../examples/_admin/_submissionStore.js', () => ({
  listAllSubmissions: () => [],
  replaceAllSubmissions: (subs: unknown) => state.replaceAllSubmissions(subs),
}));

const { BackupPanel } = await import('../examples/_admin/components/BackupPanel.js');
const { ConfirmProvider } = await import('../examples/_admin/_confirm.js');

function backupWith(theme: string) {
  return JSON.stringify({
    v: 1,
    exportedAt: '2026-10-01T00:00:00.000Z',
    forms: [
      {
        id: 'f_1',
        name: 'Quote',
        createdAt: '',
        updatedAt: '',
        schema: { brand: { name: 'Q' }, theme, themeMode: 'toggle', questions: [] },
      },
    ],
    submissions: [],
  });
}

beforeEach(() => {
  state.replaceAllForms.mockReset();
  state.replaceAllSubmissions.mockReset();
});

function show() {
  render(
    <ConfirmProvider>
      <BackupPanel />
    </ConfirmProvider>,
  );
}

describe('BackupPanel', () => {
  it('speaks plainly, and counts one form as “1 form”', async () => {
    const user = userEvent.setup();
    state.raw = backupWith('midnight');
    state.replaceAllForms.mockReturnValue(true);
    show();
    expect(document.body.textContent).not.toMatch(/JSON|localStorage/);
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('with the 1 form and 0 responses in the backup from');
    expect(dialog.textContent).not.toMatch(/\(s\)/);
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(state.replaceAllForms.mock.calls[0]![0][0].schema.theme).toBe('midnight');
  });

  it('a form in the studio’s own theme comes back in a real one', async () => {
    const user = userEvent.setup();
    state.raw = backupWith('slate');
    state.replaceAllForms.mockReturnValue(true);
    show();
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    expect(state.replaceAllForms.mock.calls[0]![0][0].schema.theme).toBe('swiss');
  });

  it('says what to do when the forms can’t be saved, or the file isn’t a backup', async () => {
    const user = userEvent.setup();
    state.raw = backupWith('swiss');
    state.replaceAllForms.mockReturnValue(false);
    show();
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    const incomplete = await screen.findByRole('alertdialog');
    expect(incomplete.textContent).toContain('This browser may be out of space');
    expect(incomplete.textContent).not.toMatch(/localStorage/);
    await user.click(within(incomplete).getByRole('button', { name: 'OK' }));

    state.raw = 'not json';
    await user.click(screen.getByRole('button', { name: 'Import backup' }));
    const refused = await screen.findByRole('alertdialog');
    expect(refused.textContent).toContain('That isn’t a Slate backup');
    expect(refused.textContent).toContain('Choose a file you saved with Export backup.');
  });
});
