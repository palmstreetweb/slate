/**
 * Audit fixes (2026-10-09), studio, what the offline studio showed:
 *  - A1: closing is cloud-only, like the password: the portable link the panel
 *    shares on this device never honoured it. The dashboard says Closed
 *    whatever the status.
 *  - A3: backup and CSV file names carry the owner's own date, with no double
 *    space where a dash was dropped.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../examples/_admin/shell/AdminShell.js', () => ({
  AdminShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/components/BuildWithAiModal.js', () => ({
  BuildWithAiModal: () => null,
  SparkleIcon: () => null,
}));

import { supportsCloseSettings } from '../examples/_admin/_formsStore.js';
import { localDateStamp } from '../examples/_admin/dateStamp.js';
import { responsesCsvFilename } from '../examples/_admin/csvExport.js';
import { Dashboard } from '../examples/_admin/pages/Dashboard.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';
import { PromptFormTitleProvider } from '../examples/_admin/promptFormTitle.js';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('closing on this device alone (audit A1)', () => {
  it('is not offered: the shared link would not honour it', () => {
    expect(supportsCloseSettings()).toBe(false);
  });

  it('the dashboard card says Closed even on a draft', () => {
    window.localStorage.setItem(
      'slate-forms',
      JSON.stringify([
        {
          id: 'f_1',
          name: 'Swim',
          status: 'draft',
          closesAt: '2026-10-01T00:00:00.000Z',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
          schema: { brand: { name: 'Swim' }, theme: 'swiss', themeMode: 'toggle', questions: [] },
        },
      ]),
    );
    render(
      <ConfirmProvider>
        <PromptFormTitleProvider>
          <Dashboard />
        </PromptFormTitleProvider>
      </ConfirmProvider>,
    );
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Draft')).toBeNull();
  });
});

describe('file-name dates (audit A3)', () => {
  it('uses the owner’s own calendar date, not UTC’s', () => {
    // Late evening local time: the UTC date is often already tomorrow.
    const evening = new Date(2026, 9, 9, 23, 30);
    expect(localDateStamp(evening)).toBe('2026-10-09');
    const morning = new Date(2026, 0, 1, 0, 10);
    expect(localDateStamp(morning)).toBe('2026-01-01');
  });

  it('names the CSV with the local date and closes the gap a dropped dash leaves', () => {
    const at = new Date(2026, 9, 9, 17, 4);
    expect(responsesCsvFilename('PSW — Contact form', at)).toBe(
      'PSW Contact form — responses 2026-10-09.csv',
    );
    expect(responsesCsvFilename('805 Quote', at)).toBe('805 Quote — responses 2026-10-09.csv');
    expect(responsesCsvFilename('—', at)).toBe('responses — responses 2026-10-09.csv');
  });
});
