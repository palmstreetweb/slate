import { describe, expect, it, vi } from 'vitest';
import {
  formatFileUploadError,
  isFileSizeError,
  resolveFileInputAccept,
} from '../src/utils/fileUploadAccept.js';
import { createFileUploadHandler } from '../src/utils/createFileUploadHandler.js';

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

  it('formatFileUploadError avoids type-rejection wording', () => {
    expect(formatFileUploadError(new Error('not a recognized image'))).toBe(
      'Could not attach that file — try again or pick a different one.',
    );
  });
});

describe('createFileUploadHandler', () => {
  it('falls back to original file when prepare fails for non-size reasons', async () => {
    const upload = vi.fn().mockResolvedValue('ok');
    const handler = createFileUploadHandler({
      upload,
      maxSizeMb: 32,
    });
    const file = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    await handler(file, 'q1', { maxSizeMb: 32 });
    expect(upload).toHaveBeenCalledWith(file, 'q1', { maxSizeMb: 32 });
  });
});
