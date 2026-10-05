/**
 * QA pass (MEDIA-16, COPY-15): an iPhone photo none of the decoders can open
 * reads as plain words for the person picking it — no "HEIC/HEIF", nothing
 * about downloading (that is the owner's Responses viewer, with its own line).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('heic-to', () => ({
  heicTo: async () => {
    throw new Error('libheif: unsupported');
  },
}));
vi.mock('heic2any', () => ({
  default: async () => {
    throw new Error('ERR_LIBHEIF format not supported');
  },
}));

import { convertHeicToJpegFile } from '../src/utils/heicToJpeg.js';
import { prepareFileForUpload } from '../src/utils/prepareFileForUpload.js';

/** An <img> that can't decode anything (jsdom never fires load or error itself). */
class BrokenImage {
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  decoding = 'async';
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_v: string) {
    setTimeout(() => this.onerror?.(new Error('decode')));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const heic = () => new File([new Uint8Array([0, 1, 2, 3])], 'IMG_0512.HEIC', { type: 'image/heic' });

describe('an iPhone photo that can’t be opened', () => {
  it('says so in plain words, with no format names or “download”', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('The source image could not be decoded.');
    });
    vi.stubGlobal('Image', BrokenImage);
    URL.createObjectURL ??= () => 'blob:test';
    URL.revokeObjectURL ??= () => undefined;
    const err = await convertHeicToJpegFile(heic()).catch((e: unknown) => e as Error);
    expect(err.message).toBe(
      'We couldn’t open this iPhone photo. Try another, or save it as a JPG first.',
    );
    expect(err.message).not.toMatch(/HEIC|HEIF|download/i);
    // The upload path passes the same words on (never stores raw HEIC).
    const viaUpload = await prepareFileForUpload(heic()).catch((e: unknown) => e as Error);
    expect(viaUpload.message).toBe(err.message);
  });
});
