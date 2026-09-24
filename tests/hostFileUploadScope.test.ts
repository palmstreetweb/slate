import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => ({
  uploadToNeonStorage: vi.fn(async () => 'slate-file:storage:ok'),
  authHeader: vi.fn(async () => ({ Authorization: 'Bearer studio-session' })),
}));

vi.mock('../examples/_admin/storageUpload.js', () => upload);
vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  hasStorageSignUrl: () => true,
}));

import { hostFileUpload } from '../examples/_admin/hostFileUpload.js';
import { clearUploadContext, setUploadContext } from '../examples/_admin/uploadContext.js';

const file = () => new File(['hello'], 'note.txt', { type: 'text/plain' });

beforeEach(() => {
  upload.uploadToNeonStorage.mockClear();
  clearUploadContext();
});

describe('upload scope (ADR-050)', () => {
  it('the public fill page uploads as public/ even when the browser is signed into a studio', async () => {
    setUploadContext('f_someone_else', { scope: 'public' });
    await hostFileUpload(file(), 'photo');
    expect(upload.uploadToNeonStorage).toHaveBeenCalledWith(expect.any(File), {
      scope: 'public',
      formId: 'f_someone_else',
    });
  });

  it('studio previews still upload as draft/ when signed in', async () => {
    setUploadContext('f_mine');
    await hostFileUpload(file(), 'photo');
    expect(upload.uploadToNeonStorage).toHaveBeenCalledWith(expect.any(File), {
      scope: 'draft',
      formId: 'f_mine',
    });
  });
});
