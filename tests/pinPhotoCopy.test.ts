/**
 * The studio's pin photo picker speaks plainly and for any device (QA leftover):
 * never "re-export as JPG from Photos", never a pipeline's own wording.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_A_PHOTO } from '@/utils/imageFileTypes.js';

const prep = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock('@/utils/prepareImageForStorage.js', () => ({
  prepareImageForStorage: async (file: File) => {
    if (prep.error) throw prep.error;
    return file;
  },
}));

const { PIN_PHOTO_UNREADABLE, pinImageFromFile } = await import('../examples/_admin/pinImage.js');

const photo = () => new File([new Uint8Array([1, 2, 3])], 'house.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  prep.error = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('pin photo picker messages', () => {
  it('a photo the browser can’t read gets one plain, device-neutral sentence', async () => {
    prep.error = new Error(
      'Could not read this image. Try a different file or re-export as JPG from Photos.',
    );
    await expect(pinImageFromFile(photo())).rejects.toThrow(PIN_PHOTO_UNREADABLE);
    expect(PIN_PHOTO_UNREADABLE).not.toMatch(/Photos|re-export|iPhone|Android|Could not/);
  });

  it('a browser without image tools, or anything technical, reads the same', async () => {
    prep.error = new Error('Image processing is not available in this browser.');
    await expect(pinImageFromFile(photo())).rejects.toThrow(PIN_PHOTO_UNREADABLE);
    prep.error = new TypeError('Failed to execute createImageBitmap');
    await expect(pinImageFromFile(photo())).rejects.toThrow(PIN_PHOTO_UNREADABLE);
  });

  it('keeps the pipeline’s sentences that already say what to do', async () => {
    prep.error = new Error(NOT_A_PHOTO);
    await expect(pinImageFromFile(photo())).rejects.toThrow(NOT_A_PHOTO);
  });

  it('a readable photo still becomes a data link', async () => {
    await expect(pinImageFromFile(photo())).resolves.toMatch(/^data:image\/jpeg;base64,/);
  });
});
