/**
 * Prepare a picked file for upload — known photo types through the 805-style
 * optimize pipeline; everything else (PDF, Office, TIFF, …) passes through.
 */

import { withInferredFileMime } from './fileMimeTypes.js';
import { isHeicLike, withInferredImageMime } from './imageFileTypes.js';
import { prepareImageForStorage } from './prepareImageForStorage.js';

const NON_IMAGE_CAP_BYTES = 32 * 1024 * 1024;

const OPTIMIZE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
]);

const OPTIMIZE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export type PrepareFileOptions = {
  /** When set, reject non-images above this many megabytes. */
  maxSizeMb?: number;
};

/** True when this file should run through canvas downscale / JPEG recompress. */
export function shouldOptimizeImage(file: File): boolean {
  const typed = withInferredImageMime(file);
  if (isHeicLike(typed)) return true;

  const name = file.name.toLowerCase();
  for (const ext of OPTIMIZE_EXT) {
    if (name.endsWith(ext)) return true;
  }

  const mime = (typed.type || '').toLowerCase();
  return OPTIMIZE_MIME.has(mime);
}

/**
 * @throws user-safe Error when the file cannot be prepared
 */
export async function prepareFileForUpload(
  file: File,
  opts: PrepareFileOptions = {},
): Promise<File> {
  const normalized = withInferredFileMime(file);

  if (shouldOptimizeImage(normalized)) {
    try {
      return await prepareImageForStorage(normalized);
    } catch {
      // Exotic or unreadable raster — store the original instead of failing.
      return passThrough(normalized, opts);
    }
  }

  return passThrough(normalized, opts);
}

function passThrough(file: File, opts: PrepareFileOptions): File {
  const cap = opts.maxSizeMb !== undefined ? opts.maxSizeMb * 1024 * 1024 : NON_IMAGE_CAP_BYTES;
  if (file.size > cap) {
    throw new Error(
      opts.maxSizeMb !== undefined
        ? `File is too big — max ${opts.maxSizeMb} MB`
        : 'File is too large. Try one under 32MB.',
    );
  }
  return file;
}
