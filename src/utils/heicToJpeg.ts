/**
 * HEIC/HEIF from iPhones is not drawable in most Chromium browsers.
 * Convert in-page so previews and canvas pipelines work.
 *
 * Strategy (newest phones first):
 * 1. Native decode via createImageBitmap / <img> (Safari often works)
 * 2. `heic-to` (libheif 1.22+) — supports iOS 18+ HEIC that heic2any can't
 * 3. Legacy `heic2any` fallback
 *
 * See ADR-026 / ADR-033.
 */

import {
  SLATE_IMAGE_TYPE_HINT,
  isHeicLike,
  withInferredImageMime,
} from './imageFileTypes.js';

function jpegFileFromBlob(blob: Blob, sourceName: string): File {
  const base =
    sourceName.replace(/\.(heic|heif)$/i, '').replace(/\.+$/u, '') || 'photo';
  return new File([blob], `${base}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function assertJpegMagic(blob: Blob): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8) {
    throw new Error('HEIC conversion did not yield a JPEG.');
  }
  return blob.type && blob.type.startsWith('image/')
    ? blob
    : new Blob([blob], { type: 'image/jpeg' });
}

async function canvasToJpegFile(
  source: CanvasImageSource,
  width: number,
  height: number,
  sourceName: string,
): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
  });
  if (!blob) throw new Error('Could not encode JPEG');
  return jpegFileFromBlob(await assertJpegMagic(blob), sourceName);
}

/** Safari / some WebKit builds can decode HEIC natively. */
async function tryNativeHeicToJpeg(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return await canvasToJpegFile(bitmap, bitmap.width, bitmap.height, file.name);
    } finally {
      bitmap.close();
    }
  } catch {
    /* try HTMLImageElement next */
  }

  try {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('decode'));
        img.src = url;
      });
      if (!img.naturalWidth || !img.naturalHeight) return null;
      return await canvasToJpegFile(img, img.naturalWidth, img.naturalHeight, file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

async function tryHeicTo(file: File): Promise<File | null> {
  try {
    const { heicTo } = await import('heic-to');
    const raw = await heicTo({
      blob: file,
      type: 'image/jpeg',
      quality: 0.92,
    });
    const blob = raw instanceof Blob ? raw : new Blob([raw], { type: 'image/jpeg' });
    if (!blob.size) return null;
    return jpegFileFromBlob(await assertJpegMagic(blob), file.name);
  } catch (e) {
    console.warn('[heic-to]', e);
    return null;
  }
}

async function tryHeic2Any(file: File): Promise<File | null> {
  try {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92,
    });
    const raw = Array.isArray(result) ? result[0]! : result;
    if (!raw || raw.size === 0) return null;
    const blob =
      raw.type && raw.type.startsWith('image/')
        ? raw
        : new Blob([raw], { type: 'image/jpeg' });
    return jpegFileFromBlob(await assertJpegMagic(blob), file.name);
  } catch (e) {
    console.warn('[heic2any]', e);
    return null;
  }
}

/**
 * @throws If conversion fails or lib cannot run in this environment
 */
export async function convertHeicToJpegFile(file: File): Promise<File> {
  const typed = withInferredImageMime(file);

  const native = await tryNativeHeicToJpeg(typed);
  if (native) return native;

  const modern = await tryHeicTo(typed);
  if (modern) return modern;

  const legacy = await tryHeic2Any(typed);
  if (legacy) return legacy;

  throw new Error(
    'Could not read this HEIC/HEIF photo in the browser. Download the file, or re-upload after exporting as JPG from Photos.',
  );
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
