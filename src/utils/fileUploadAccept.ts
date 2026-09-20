/**
 * File-picker `accept` attribute — only restrict when the form author
 * explicitly sets a filter. Blank = any file type (no browser gatekeeping).
 */

export function resolveFileInputAccept(accept?: string): string | undefined {
  const trimmed = accept?.trim();
  return trimmed ? trimmed : undefined;
}

/** Prefer a clear host message; only size/network get special copy. */
export function formatFileUploadError(err: unknown, maxSizeMb?: number): string {
  if (err instanceof Error) {
    if (/too (big|large)/i.test(err.message)) {
      return maxSizeMb !== undefined
        ? `That file is too large — max ${maxSizeMb} MB.`
        : err.message;
    }
    if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
      return 'Could not upload — check your connection and try again.';
    }
    // Surface server/sign messages (404 form, 401, size, etc.)
    const msg = err.message.trim();
    if (msg && msg.length < 180 && !/^error$/i.test(msg)) {
      return msg;
    }
  }
  return 'Could not attach that file — try again or pick a different one.';
}

export function isFileSizeError(err: unknown): boolean {
  return err instanceof Error && /too (big|large)/i.test(err.message);
}
