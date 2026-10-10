/**
 * Audit fixes (2026-10-09), studio B6: the storagesign helpers answer "none"
 * when the request itself fails (a dropped connection), instead of throwing
 * into loaders that then spin forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  hasStorageSignUrl: () => true,
  getStorageSignUrl: () => 'https://sign.invalid',
  getSubmitUrl: () => 'https://submit.invalid',
}));
vi.mock('../examples/_admin/neon/env.js', () => ({
  getNeon: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }),
    },
  }),
}));
vi.mock('../examples/_admin/localFileStore.js', () => ({
  getLocalUploadMeta: async () => null,
  saveLocalUpload: async () => 'slate-file://local',
}));

import {
  getStorageContentBlob,
  getStorageDownloadUrl,
  getStorageUploadMeta,
} from '../examples/_admin/storageUpload.js';

const ref = 'slate-file://storage:draft/f1/00000000-0000-4000-8000-000000000000/photo.jpg';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('storagesign requests that never get through (audit B6)', () => {
  it('meta, link and content each resolve to null and say so in the console', async () => {
    await expect(getStorageUploadMeta(ref)).resolves.toBeNull();
    await expect(getStorageDownloadUrl(ref)).resolves.toBeNull();
    await expect(getStorageContentBlob(ref)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});
