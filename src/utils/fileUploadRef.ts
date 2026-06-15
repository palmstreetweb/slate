/**
 * Opaque file-upload answer refs returned by host upload handlers.
 * Format: `slate-file://{uuid}` — metadata lives in host storage (IndexedDB, S3, etc.).
 */

export const SLATE_FILE_REF_PREFIX = 'slate-file://';

export type FileUploadMeta = {
  name: string;
  size: number;
  mime: string;
};

export function isFileUploadRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SLATE_FILE_REF_PREFIX);
}

export function makeFileUploadRef(id: string): string {
  return `${SLATE_FILE_REF_PREFIX}${id}`;
}

export function parseFileUploadRef(ref: string): string | null {
  if (!ref.startsWith(SLATE_FILE_REF_PREFIX)) return null;
  const id = ref.slice(SLATE_FILE_REF_PREFIX.length);
  return id || null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human label for a stored upload answer (ref, URL, or raw File). */
export function describeFileUploadAnswer(
  value: File | string | undefined,
  meta?: FileUploadMeta | null,
): string | null {
  if (value === undefined || value === '') return null;
  if (typeof File !== 'undefined' && value instanceof File) {
    return `${value.name} (${formatBytes(value.size)})`;
  }
  if (typeof value === 'string') {
    if (meta) return `${meta.name} (${formatBytes(meta.size)})`;
    if (isFileUploadRef(value)) return 'Uploaded file';
    try {
      const url = new URL(value);
      const seg = url.pathname.split('/').filter(Boolean).pop();
      return seg ?? value;
    } catch {
      return value;
    }
  }
  return String(value);
}
