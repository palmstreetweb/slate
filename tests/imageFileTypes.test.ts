import { describe, expect, it } from 'vitest';
import { inferFileMimeType } from '../src/utils/fileMimeTypes.js';
import { shouldOptimizeImage } from '../src/utils/prepareFileForUpload.js';
import {
  inferImageMimeType,
  isHeicLike,
  isLikelyImageFile,
  withInferredImageMime,
} from '../src/utils/imageFileTypes.js';
import { isFileUploadRef, makeFileUploadRef, describeFileUploadAnswer } from '../src/utils/fileUploadRef.js';

describe('fileMimeTypes', () => {
  it('infers PDF when type is blank', () => {
    const file = new File(['%PDF'], 'quote.pdf', { type: '' });
    expect(inferFileMimeType(file)).toBe('application/pdf');
  });
});

describe('shouldOptimizeImage', () => {
  it('optimizes jpg and png only among rasters we handle', () => {
    expect(shouldOptimizeImage(new File(['x'], 'a.jpg', { type: '' }))).toBe(true);
    expect(shouldOptimizeImage(new File(['x'], 'a.png', { type: '' }))).toBe(true);
    expect(shouldOptimizeImage(new File(['x'], 'scan.tiff', { type: 'image/tiff' }))).toBe(false);
  });

  it('does not optimize documents', () => {
    expect(shouldOptimizeImage(new File(['x'], 'brief.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(shouldOptimizeImage(new File(['x'], 'notes.docx', { type: '' }))).toBe(false);
  });
});

describe('imageFileTypes', () => {
  it('infers JPEG from extension when type is blank', () => {
    const file = new File(['x'], 'photo.jpg', { type: '' });
    expect(inferImageMimeType(file)).toBe('image/jpeg');
    expect(withInferredImageMime(file).type).toBe('image/jpeg');
  });

  it('detects HEIC by extension', () => {
    const file = new File(['x'], 'IMG.HEIC', { type: '' });
    expect(isHeicLike(file)).toBe(true);
    expect(isLikelyImageFile(file)).toBe(true);
  });
});

describe('fileUploadRef', () => {
  it('round-trips slate-file refs', () => {
    const ref = makeFileUploadRef('abc-123');
    expect(isFileUploadRef(ref)).toBe(true);
    expect(describeFileUploadAnswer(ref, { name: 'a.jpg', size: 2048, mime: 'image/jpeg' })).toBe(
      'a.jpg (2 KB)',
    );
  });
});
