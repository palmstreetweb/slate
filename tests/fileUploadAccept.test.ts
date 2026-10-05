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
      'We couldn’t add that file. Try again, or pick a different one.',
    );
  });

  it('never shows a browser’s technical text (MEDIA-06)', () => {
    const quota = new Error('The quota has been exceeded.');
    quota.name = 'QuotaExceededError';
    const fallback = 'We couldn’t add that file. Try again, or pick a different one.';
    expect(formatFileUploadError(quota)).toBe(fallback);
    expect(formatFileUploadError(new TypeError('x is not a function'))).toBe(fallback);
    expect(formatFileUploadError('boom')).toBe(fallback);
  });

  it('only real network failures say “check your connection” (COPY-03)', () => {
    const offline = 'We couldn’t upload that. Check your connection and try again.';
    expect(formatFileUploadError(new TypeError('Failed to fetch'))).toBe(offline);
    expect(formatFileUploadError(new TypeError('Load failed'))).toBe(offline);
    // A host sentence that merely contains "upload failed" is not a network error.
    expect(formatFileUploadError(new Error('That upload didn’t go through. Upload failed.'))).toBe(
      'That upload didn’t go through. Upload failed.',
    );
  });

  it('one “too big” sentence with the limit (COPY-14)', () => {
    expect(formatFileUploadError(new Error('That file is too big. The limit is 32 MB.'), 5)).toBe(
      'That file is too big. The limit is 5 MB.',
    );
    expect(formatFileUploadError(new Error('That file is too big. The limit is 32 MB.'))).toBe(
      'That file is too big. The limit is 32 MB.',
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
