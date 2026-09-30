import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import {
  formatStorage,
  storageBannerCopy,
  storageLevel,
  storageMeterText,
  storagePendingText,
  storagePercent,
  type StorageQuota,
} from '../examples/_admin/storageQuota.js';
import { StorageBanner, StorageMeter } from '../examples/_admin/components/StorageMeter.js';
import { primeStorageQuota } from '../examples/_admin/neon/storageQuotaRemote.js';
import { Dashboard } from '../examples/_admin/pages/Dashboard.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';

// The shell (auth, nav) isn't under test: the dashboard body is.
vi.mock('../examples/_admin/shell/AdminShell.js', () => ({
  AdminShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// ADR-067: the owner sees their file storage next to the forms count, and a
// banner once it is nearly or completely full.

const MB = 1024 * 1024;
const GB = 1024 * MB;
const q = (used: number, pending = 0): StorageQuota => ({ used, max: GB, pending, files: 3 });

afterEach(() => primeStorageQuota(null));

describe('storage numbers and copy', () => {
  it('formats like the brief: "120 MB of 1 GB"', () => {
    expect(storageMeterText(q(120 * MB))).toBe('120 MB of 1 GB');
    expect(formatStorage(0)).toBe('0 KB');
    expect(formatStorage(450_000)).toBe('439 KB');
    expect(formatStorage(2.5 * MB)).toBe('2.5 MB');
    expect(formatStorage(999 * MB)).toBe('999 MB');
    expect(formatStorage(1000 * MB)).toBe('1 GB');
    expect(formatStorage(1.5 * GB)).toBe('1.5 GB');
    expect(formatStorage(Number.NaN)).toBe('0 KB');
  });

  it('levels: ok below 80 %, near from 80 %, full at the limit', () => {
    expect(storageLevel(q(0))).toBe('ok');
    expect(storageLevel(q(0.79 * GB))).toBe('ok');
    expect(storageLevel(q(0.8 * GB))).toBe('near');
    expect(storageLevel(q(GB - 1))).toBe('near');
    expect(storageLevel(q(GB))).toBe('full');
    expect(storageLevel({ used: 5, max: 0, pending: 0, files: 0 })).toBe('ok');
  });

  it('"still uploading" only when unfinished uploads count', () => {
    expect(storagePendingText(q(874 * MB, 12 * MB))).toBe('12 MB still uploading');
    expect(storagePendingText(q(874 * MB, 3000))).toBe('3 KB still uploading');
    expect(storagePendingText(q(874 * MB, 0))).toBeNull();
  });

  it('the bar never hides a first file and never passes 100 %', () => {
    expect(storagePercent(q(0))).toBe(0);
    expect(storagePercent(q(1))).toBe(1);
    expect(storagePercent(q(GB / 2))).toBe(50);
    expect(storagePercent(q(2 * GB))).toBe(100);
  });

  it('banner: none with room; near says how much and what to do; full says what respondents see', () => {
    expect(storageBannerCopy(q(100 * MB))).toBeNull();
    const near = storageBannerCopy(q(900 * MB))!;
    expect(near.title).toBe('File storage is almost full');
    expect(near.body).toMatch(/^900 MB of 1 GB used\./);
    expect(near.body).toMatch(
      /permanently delete responses you don’t need \(responses in Trash count/,
    );
    const full = storageBannerCopy(q(GB))!;
    expect(full.title).toBe('File storage is full');
    expect(full.body).toContain('This form can’t accept more files right now.');
  });
});

describe('StorageMeter and StorageBanner', () => {
  it('the meter is a labelled meter with the used text, and unfinished uploads only when there are some', () => {
    const { rerender } = render(<StorageMeter quota={q(874 * MB, 12 * MB)} />);
    const m = screen.getByRole('meter', { name: 'File storage' });
    expect(m).toHaveAttribute('aria-valuetext', '874 MB of 1 GB used, 12 MB still uploading');
    expect(m).toHaveAttribute('data-level', 'near');
    expect(m).toHaveTextContent('Storage874 MB of 1 GB· 12 MB still uploading');
    expect(m.getAttribute('title')).toMatch(/stop counting after 2 hours\.$/);
    rerender(<StorageMeter quota={q(120 * MB)} />);
    expect(m).toHaveAttribute('aria-valuetext', '120 MB of 1 GB used');
    expect(m).toHaveAttribute('data-level', 'ok');
    expect(m).toHaveTextContent(/^Storage120 MB of 1 GB$/);
    expect(m.textContent).not.toContain('uploading');
  });

  it('shows the effective limit an override gives', () => {
    render(<StorageMeter quota={{ used: 1.2 * GB, max: 5 * GB, pending: 0, files: 9 }} />);
    expect(screen.getByRole('meter')).toHaveTextContent('1.2 GB of 5 GB');
  });

  it('the banner is a status when near and an alert when full; nothing with room', () => {
    const { rerender, container } = render(<StorageBanner quota={q(10 * MB)} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<StorageBanner quota={q(850 * MB)} />);
    expect(screen.getByRole('status')).toHaveTextContent('File storage is almost full');
    rerender(<StorageBanner quota={q(GB)} />);
    expect(screen.getByRole('alert')).toHaveTextContent('File storage is full');
  });
});

describe('Dashboard', () => {
  it('shows the meter under the forms count once the numbers arrive, and the banner near the limit', () => {
    render(
      <ConfirmProvider>
        <Dashboard />
      </ConfirmProvider>,
    );
    expect(screen.queryByRole('meter')).toBeNull();
    act(() => primeStorageQuota(q(870 * MB)));
    expect(screen.getByRole('meter', { name: 'File storage' })).toHaveTextContent('870 MB of 1 GB');
    expect(screen.getByRole('status')).toHaveTextContent('File storage is almost full');
  });
});
