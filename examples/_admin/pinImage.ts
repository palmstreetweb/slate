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

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(file);
  });
}

/** A compressed `data:image/jpeg` URL for the question, or a user-safe error. */
export async function pinImageFromFile(file: File): Promise<string> {
  const jpeg = await prepareImageForStorage(file, 'pin');
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
