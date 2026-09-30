import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-067: the studio reads its own storage through storage_quota_status (the
// only 021 function the Data API may call), and after a permanent delete asks
// storagesign to delete that account's files.

const neon = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  hasStorageSignUrl: () => true,
  getStorageSignUrl: () => 'https://sign.invalid',
}));
vi.mock('../examples/_admin/neon/client.js', () => ({ getNeon: () => ({ rpc: neon.rpc }) }));
vi.mock('../examples/_admin/storageUpload.js', () => ({
  authHeader: async () => ({ Authorization: 'Bearer owner-token' }),
}));

import {
  afterPermanentDelete,
  getStorageQuota,
  primeStorageQuota,
  refreshStorageQuota,
} from '../examples/_admin/neon/storageQuotaRemote.js';

beforeEach(() => {
  neon.rpc.mockReset();
  primeStorageQuota(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('storage quota over the Data API', () => {
  it('reads bigint strings as numbers', async () => {
    neon.rpc.mockResolvedValue({
      data: [{ used_bytes: '125829120', max_bytes: '1073741824', pending_bytes: '0', files: 12 }],
      error: null,
    });
    await refreshStorageQuota();
    expect(neon.rpc).toHaveBeenCalledWith('storage_quota_status');
    expect(getStorageQuota()).toEqual({ used: 125829120, max: 1073741824, pending: 0, files: 12 });
  });

  it('an error or a missing function (before 021) keeps the meter hidden', async () => {
    neon.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await refreshStorageQuota();
    expect(getStorageQuota()).toBeNull();
    neon.rpc.mockResolvedValue({ data: [{ used_bytes: 'x', max_bytes: 0 }], error: null });
    await refreshStorageQuota();
    expect(getStorageQuota()).toBeNull();
  });

  it('after permanent deletes: one purge (Bearer) and one refresh, debounced', async () => {
    vi.useFakeTimers();
    neon.rpc.mockResolvedValue({
      data: [{ used_bytes: 0, max_bytes: 1073741824, pending_bytes: 0, files: 0 }],
      error: null,
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ deleted: 3, more: false })));
    vi.stubGlobal('fetch', fetch);
    afterPermanentDelete();
    afterPermanentDelete();
    afterPermanentDelete();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sign.invalid');
    expect(JSON.parse(String(init.body))).toEqual({ op: 'purge' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
    expect(neon.rpc).toHaveBeenCalledTimes(1);
  });

  it('purges again while the server says there is more, three rounds at most', async () => {
    vi.useFakeTimers();
    neon.rpc.mockResolvedValue({ data: null, error: null });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ deleted: 100, more: true })));
    vi.stubGlobal('fetch', fetch);
    afterPermanentDelete();
    await vi.advanceTimersByTimeAsync(1600);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
