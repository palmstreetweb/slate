/**
 * Factory for `onFileUpload` — runs 805-style prepare, then delegates to host storage.
 */

import { isHeicLike, withInferredImageMime } from './imageFileTypes.js';
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
      if (isFileSizeError(err)) throw err;
      // Never store raw HEIC/HEIF — browsers can't preview it and Responses breaks.
      if (isHeicLike(withInferredImageMime(file))) {
        throw err instanceof Error
          ? err
          : new Error(
              'Could not convert this HEIC photo to JPG. Export as JPG from Photos and try again.',
            );
      }
      // Other exotic rasters — store the original instead of failing the form.
      prepared = file;
    }
    return opts.upload(prepared, questionId, ctx);
  };
}
