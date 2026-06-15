/**
 * File-picker `accept` attribute — only restrict when the form author
 * explicitly sets a filter. Blank = any file type (no browser gatekeeping).
 */

export function resolveFileInputAccept(accept?: string): string | undefined {
  const trimmed = accept?.trim();
  return trimmed ? trimmed : undefined;
}

/** Only size limits should block a pick — never MIME/type wording. */
export function formatFileUploadError(err: unknown, maxSizeMb?: number): string {
  if (err instanceof Error) {
    if (/too (big|large)/i.test(err.message)) {
      return maxSizeMb !== undefined
        ? `That file is too large — max ${maxSizeMb} MB.`
        : err.message;
    }
    if (/upload failed/i.test(err.message) || /network/i.test(err.message)) {
      return 'Could not upload — check your connection and try again.';
    }
  }
  return 'Could not attach that file — try again or pick a different one.';
}

export function isFileSizeError(err: unknown): boolean {
  return err instanceof Error && /too (big|large)/i.test(err.message);
}
