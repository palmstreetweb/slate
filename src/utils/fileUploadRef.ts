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

export function filenameHintFromFileRef(ref: string): string | null {
  if (!isFileUploadRef(ref)) return null;
  const id = parseFileUploadRef(ref);
  if (!id) return null;
  // Neon storage refs: storage:public|draft/{formId}/{uuid}/{filename}
  if (id.startsWith('storage:')) {
    const seg = id.split('/').filter(Boolean).pop();
    if (seg) {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    }
  }
  return null;
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
    if (isFileUploadRef(value)) {
      const hint = filenameHintFromFileRef(value);
      return hint ?? 'Uploaded file';
    }
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

/** Labels for one or many upload answers (ADR-032). */
export function describeFileUploadAnswers(
  value: File | string | Array<File | string> | undefined,
  metaByRef?: (ref: string) => FileUploadMeta | null | undefined,
): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value
      .map((item) =>
        describeFileUploadAnswer(
          item,
          typeof item === 'string' ? metaByRef?.(item) ?? null : null,
        ),
      )
      .filter(Boolean)
      .join(', ');
  }
  return describeFileUploadAnswer(
    value,
    typeof value === 'string' ? metaByRef?.(value) ?? null : null,
  );
}
