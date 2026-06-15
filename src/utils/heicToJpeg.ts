/**
 * HEIC/HEIF from iPhones is not drawable in most browsers. Convert in-page
 * with heic2any (lazy-loaded) so previews and canvas pipelines work.
 *
 * Ported from 805 Sealcoating `lib/heic-to-jpeg.ts`.
 */

import {
  SLATE_IMAGE_TYPE_HINT,
  isHeicLike,
  withInferredImageMime,
} from './imageFileTypes.js';

/**
 * @throws If conversion fails or lib cannot run in this environment
 */
export async function convertHeicToJpegFile(file: File): Promise<File> {
  try {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    });
    const raw = Array.isArray(result) ? result[0]! : result;
    if (!raw || raw.size === 0) {
      throw new Error('HEIC conversion produced an empty image.');
    }
    const blob =
      raw.type && raw.type.startsWith('image/')
        ? raw
        : new Blob([raw], { type: 'image/jpeg' });
    const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    if (head[0] !== 0xff || head[1] !== 0xd8) {
      throw new Error(
        'HEIC conversion did not yield a JPEG this browser can show. Export as JPG from Photos and try again.',
      );
    }
    const base =
      file.name.replace(/\.(heic|heif)$/i, '').replace(/\.+$/u, '') || 'photo';
    return new File([blob], `${base}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('HEIC conversion')) {
      throw e;
    }
    console.warn('[heic2any]', e);
    throw new Error(
      'Could not read this HEIC/HEIF file in the browser. Open it in Photos, export as JPG, and try again.',
    );
  }
}

/** Use after a file pick: pass through normal images, convert HEIC for previews & canvas. */
export async function normalizePickedImageFile(file: File): Promise<File> {
  const typed = withInferredImageMime(file);
  if (isHeicLike(typed)) {
    return convertHeicToJpegFile(typed);
  }
  if (!typed.type.startsWith('image/')) {
    throw new Error(`That file is not a recognized image. ${SLATE_IMAGE_TYPE_HINT}`);
  }
  if (typed.type === 'image/svg+xml') {
    throw new Error(`SVG is not supported for photos. ${SLATE_IMAGE_TYPE_HINT}`);
  }
  return typed;
}
