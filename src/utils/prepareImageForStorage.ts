/**
 * Client-side downscale + JPEG recompression before upload.
 * Uses Canvas; HEIC/HEIF is converted first (see `heicToJpeg`).
 *
 * Ported from 805 Sealcoating `lib/prepare-image-for-storage.ts`.
 */

import { convertHeicToJpegFile } from './heicToJpeg.js';
import {
  SLATE_IMAGE_TYPE_HINT,
  isHeicLike,
  withInferredImageMime,
} from './imageFileTypes.js';

const PROFILES = {
  /**
   * Default photo profile. Long edge + byte cap keep uploads quick on cellular;
   * quality steps down until under maxBytes.
   */
  default: {
    maxEdge: 1920,
    maxBytes: 450_000,
    outName: 'photo.jpg' as const,
    qualityStart: 0.75,
  },
} as const;

export type ImageStorageProfile = keyof typeof PROFILES;

const INPUT_CAP_BYTES = 32 * 1024 * 1024;

/**
 * Downscale to fit inside maxEdge, then re-encode as progressive JPEG, lowering quality
 * until under maxBytes (or floor quality is hit).
 * @throws Error with a user-safe message
 */
export async function prepareImageForStorage(
  file: File,
  profile: ImageStorageProfile = 'default',
): Promise<File> {
  const typed = withInferredImageMime(file);
  if (!typed.type.startsWith('image/') && !isHeicLike(typed)) {
    throw new Error(`That file is not a recognized image. ${SLATE_IMAGE_TYPE_HINT}`);
  }
  if (typed.size > INPUT_CAP_BYTES) {
    throw new Error('Image is too large. Try one under 32MB.');
  }
  if (typed.type === 'image/svg+xml') {
    throw new Error(`SVG images are not supported. ${SLATE_IMAGE_TYPE_HINT}`);
  }

  let source = typed;
  if (isHeicLike(typed)) {
    source = await convertHeicToJpegFile(typed);
  }

  const { maxEdge, maxBytes, outName, qualityStart } = PROFILES[profile];
  const bitmap = await tryLoadBitmap(source);
  if (!bitmap) {
    throw new Error(
      'Could not read this image. Try a different file or re-export as JPG from Photos.',
    );
  }

  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const scale = w > 0 && h > 0 ? Math.min(1, maxEdge / Math.max(w, h)) : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Image processing is not available in this browser.');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, tw, th);

    return await canvasToJpegFileUnderSize(canvas, maxBytes, outName, qualityStart);
  } finally {
    bitmap.close();
  }
}

async function tryLoadBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    /* next */
  }
  try {
    const orient: ImageBitmapOptions = { imageOrientation: 'from-image' };
    return await createImageBitmap(file, orient);
  } catch {
    /* next */
  }
  try {
    return await loadBitmapViaHtmlImage(file);
  } catch {
    return null;
  }
}

async function loadBitmapViaHtmlImage(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    const done = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
    });
    img.src = url;
    await done;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('zero dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function canvasToJpegFileUnderSize(
  canvas: HTMLCanvasElement,
  maxBytes: number,
  outName: string,
  qualityStart = 0.9,
): Promise<File> {
  for (let q = qualityStart; q >= 0.32; q -= 0.07) {
    const blob = await new Promise<Blob | null>((res) => {
      canvas.toBlob((b) => res(b), 'image/jpeg', q);
    });
    if (!blob) {
      throw new Error('Could not compress the image.');
    }
    if (blob.size <= maxBytes) {
      return new File([blob], outName, { type: 'image/jpeg' });
    }
  }
  const last = await new Promise<Blob | null>((res) => {
    canvas.toBlob((b) => res(b), 'image/jpeg', 0.3);
  });
  if (!last) {
    throw new Error('Could not compress the image.');
  }
  return new File([last], outName, { type: 'image/jpeg' });
}
