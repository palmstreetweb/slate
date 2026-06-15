/**
 * Browsers and OS file pickers often omit or misreport MIME types (especially
 * HEIC, and occasionally JPEG/PNG). Infer from the filename when safe so
 * uploads are not rejected on extension alone.
 *
 * Ported from 805 Sealcoating `lib/image-file-types.ts`.
 */

export const SLATE_IMAGE_INPUT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif';

/** User-facing hint when a pick is rejected */
export const SLATE_IMAGE_TYPE_HINT = 'Use JPG, PNG, WebP, GIF, or iPhone HEIC/HEIF.';

const EXT_TO_MIME: readonly [ext: string, mime: string][] = [
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.heic', 'image/heic'],
  ['.heif', 'image/heif'],
];

/**
 * Prefer the file extension when it matches a known photo type (fixes blank or
 * wrong MIME from the OS). Then trust a non-empty `image/*` type (except SVG
 * is only honored when reported as such).
 */
export function inferImageMimeType(file: File): string | null {
  const raw = (file.type || '').trim();
  const lower = raw.toLowerCase();
  const name = file.name.toLowerCase();

  if (lower === 'image/svg+xml') return 'image/svg+xml';

  for (const [ext, mime] of EXT_TO_MIME) {
    if (name.endsWith(ext)) return mime;
  }

  if (lower.startsWith('image/')) return raw;
  return null;
}

/** Clone `File` with an inferred `type` when the browser left it blank. */
export function withInferredImageMime(file: File): File {
  const inferred = inferImageMimeType(file);
  if (!inferred) return file;
  const cur = (file.type || '').trim();
  if (cur === inferred) return file;
  return new File([file], file.name, {
    type: inferred,
    lastModified: file.lastModified,
  });
}

export function isLikelyImageFile(file: File): boolean {
  const typed = withInferredImageMime(file);
  if (isHeicLike(typed)) return true;
  return typed.type.startsWith('image/') && typed.type !== 'image/svg+xml';
}

export function isHeicLike(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  if (
    t === 'image/heic' ||
    t === 'image/heif' ||
    t === 'image/heic-sequence' ||
    t === 'image/heif-sequence'
  ) {
    return true;
  }
  const n = file.name.toLowerCase();
  return n.endsWith('.heic') || n.endsWith('.heif');
}
