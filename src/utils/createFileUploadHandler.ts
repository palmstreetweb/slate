/**
 * Factory for `onFileUpload` — runs 805-style prepare, then delegates to host storage.
 */

import { prepareFileForUpload } from './prepareFileForUpload.js';
import { isFileSizeError } from './fileUploadAccept.js';

export type FileUploadHandler = (
  file: File,
  questionId: string,
  ctx?: { maxSizeMb?: number },
) => Promise<string>;

export type FileUploadStorageHandler = FileUploadHandler;

export type CreateFileUploadHandlerOptions = {
  /** Persist the prepared file; must return an opaque string stored as the answer. */
  upload: FileUploadStorageHandler;
  maxSizeMb?: number;
};

/** Build an `onFileUpload` callback with client-side optimize + host storage. */
export function createFileUploadHandler(opts: CreateFileUploadHandlerOptions): FileUploadHandler {
  return async (file, questionId, ctx) => {
    const maxSizeMb = ctx?.maxSizeMb ?? opts.maxSizeMb;
    let prepared = file;
    try {
      prepared = await prepareFileForUpload(file, { maxSizeMb });
    } catch (err) {
      // Only block on size — if optimize/prepare fails, store the original file.
      if (isFileSizeError(err)) throw err;
      prepared = file;
    }
    return opts.upload(prepared, questionId, ctx);
  };
}
