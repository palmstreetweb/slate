/**
 * File-picker `accept` attribute — only restrict when the form author
 * explicitly sets a filter. Blank = any file type (no browser gatekeeping).
 */

export function resolveFileInputAccept(accept?: string): string | undefined {
  const trimmed = accept?.trim();
  return trimmed ? trimmed : undefined;
}

/** The one "too big" sentence, wherever a size limit refuses a file. */
export const tooBigMessage = (mb: number): string => `That file is too big. The limit is ${mb} MB.`;

/**
 * Words a respondent can act on. A host's own sentence (a plain `Error`) is
 * shown as written; size and network failures get their own copy; anything
 * else — a browser's `QuotaExceededError`, a `TypeError`, an empty message —
 * gets a plain fallback instead of its technical text (QA pass, MEDIA-06).
 */
export function formatFileUploadError(err: unknown, maxSizeMb?: number): string {
  if (err instanceof Error) {
    if (/too (big|large)/i.test(err.message)) {
      return maxSizeMb !== undefined ? tooBigMessage(maxSizeMb) : err.message;
    }
    // Anchored: Safari says "Load failed"; a host's "Upload failed" isn't the network.
    if (/failed to fetch|networkerror|^load failed/i.test(err.message)) {
      return 'We couldn’t upload that. Check your connection and try again.';
    }
    const msg = err.message.trim();
    if (err.name === 'Error' && msg && msg.length < 180 && !/^error$/i.test(msg)) {
      return msg;
    }
  }
  return 'We couldn’t add that file. Try again, or pick a different one.';
}

export function isFileSizeError(err: unknown): boolean {
  return err instanceof Error && /too (big|large)/i.test(err.message);
}
