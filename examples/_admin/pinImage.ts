/**
 * The photo on a pin-the-spot question (ADR-065), from an owner's upload.
 *
 * Published images reach respondents inside the published schema — picture
 * choice and the logo as links, the logo also as a small `data:` image
 * (ADR-053). Studio uploads in `draft/` storage are readable by the owner
 * only (ADR-046/058), so serving one to anonymous respondents would need a
 * new public read path. Instead the photo is prepared with the usual image
 * pipeline (HEIC → JPEG, the `pin` profile: 1,200 px, ~110 KB) and kept in
 * the question as a `data:image/jpeg` URL, capped by the engine's own
 * `PIN_IMAGE_DATA_MAX`. An `https:` link still works too.
 */

import { prepareImageForStorage } from '@/utils/prepareImageForStorage.js';
import { PIN_IMAGE_DATA_MAX, safeImageSrc } from '@/utils/brandLogo.js';
import { NOT_A_PHOTO } from '@/utils/imageFileTypes.js';
import { tooBigMessage } from '@/utils/fileUploadAccept.js';

/**
 * What the picker says when a photo can't be prepared: plain, and the same on any
 * device (QA leftover: it said "re-export as JPG from Photos").
 */
export const PIN_PHOTO_UNREADABLE =
  'That photo couldn’t be opened. Try a different one, like a JPG or PNG.';

/** The image pipeline's own sentences that already read plainly, kept as they are. */
const PLAIN = new Set([NOT_A_PHOTO, tooBigMessage(32)]);

/** The pipeline's error, or the plain sentence when its text isn't one an owner should read. */
function pinPhotoError(err: unknown): Error {
  const message = err instanceof Error ? err.message : '';
  if (PLAIN.has(message) || message.startsWith('We couldn’t open this iPhone photo')) {
    return new Error(message);
  }
  console.error('[slate] pin photo failed:', err);
  return new Error(PIN_PHOTO_UNREADABLE);
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(PIN_PHOTO_UNREADABLE));
    reader.readAsDataURL(file);
  });
}

/** A compressed `data:image/jpeg` URL for the question, or a user-safe error. */
export async function pinImageFromFile(file: File): Promise<string> {
  let jpeg: File;
  try {
    jpeg = await prepareImageForStorage(file, 'pin');
  } catch (err) {
    throw pinPhotoError(err);
  }
  const url = await readAsDataUrl(jpeg);
  if (safeImageSrc(url, PIN_IMAGE_DATA_MAX) === null) {
    throw new Error('That photo is too detailed to use here. Try a smaller or simpler one.');
  }
  return url;
}

/** Roughly how many kilobytes a data URL adds to the published form. */
export function dataUrlKb(src: string | undefined): number {
  if (!src || !src.startsWith('data:')) return 0;
  return Math.round((src.length * 3) / 4 / 1024);
}
