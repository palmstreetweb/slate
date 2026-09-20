import { describe, expect, it, vi } from 'vitest';
import {
  formatFileUploadError,
  isFileSizeError,
  resolveFileInputAccept,
} from '../src/utils/fileUploadAccept.js';
import { createFileUploadHandler } from '../src/utils/createFileUploadHandler.js';

vi.mock('../src/utils/prepareFileForUpload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/prepareFileForUpload.js')>();
  return {
    ...actual,
    prepareFileForUpload: vi.fn(actual.prepareFileForUpload),
  };
});

import { prepareFileForUpload } from '../src/utils/prepareFileForUpload.js';

describe('fileUploadAccept', () => {
  it('blank accept means no browser filter', () => {
    expect(resolveFileInputAccept(undefined)).toBeUndefined();
    expect(resolveFileInputAccept('')).toBeUndefined();
    expect(resolveFileInputAccept('  ')).toBeUndefined();
    expect(resolveFileInputAccept('image/*')).toBe('image/*');
  });

  it('isFileSizeError detects size messages only', () => {
    expect(isFileSizeError(new Error('File is too big — max 10 MB'))).toBe(true);
    expect(isFileSizeError(new Error('not a recognized image'))).toBe(false);
  });

  it('formatFileUploadError prefers clear host messages', () => {
    expect(formatFileUploadError(new Error('not a recognized image'))).toBe(
      'not a recognized image',
    );
    expect(formatFileUploadError(new Error(''))).toBe(
      'Could not attach that file — try again or pick a different one.',
    );
  });
});

describe('createFileUploadHandler', () => {
  it('falls back to original file when prepare fails for non-size reasons', async () => {
    vi.mocked(prepareFileForUpload).mockRejectedValueOnce(new Error('canvas blew up'));
    const upload = vi.fn().mockResolvedValue('ok');
    const handler = createFileUploadHandler({
      upload,
      maxSizeMb: 32,
    });
    const file = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    await handler(file, 'q1', { maxSizeMb: 32 });
    expect(upload).toHaveBeenCalledWith(file, 'q1', { maxSizeMb: 32 });
  });

  it('does not upload raw HEIC when prepare fails', async () => {
    vi.mocked(prepareFileForUpload).mockRejectedValueOnce(
      new Error('Could not read this HEIC/HEIF photo.'),
    );
    const upload = vi.fn().mockResolvedValue('ok');
    const handler = createFileUploadHandler({
      upload,
      maxSizeMb: 32,
    });
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'IMG_0512.HEIC', {
      type: 'image/heic',
    });
    await expect(handler(file, 'q1', { maxSizeMb: 32 })).rejects.toThrow(/HEIC/i);
    expect(upload).not.toHaveBeenCalled();
  });
});
