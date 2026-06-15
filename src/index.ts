/**
 * Public entry for `@palmstreetweb/slate`.
 *
 * Consumers should only import from this barrel — anything not re-exported
 * here is internal and may move between minor versions.
 */

import type { Question } from './types/Question.js';
import type { Schema } from './types/Schema.js';

export type * from './types/index.js';
export { isQuestionType } from './types/index.js';

export {
  themes,
  classic,
  editorial,
  swiss,
  midnight,
  sunset,
  terminal,
  forest,
  mono,
  constellation,
  bloom,
  riso,
  memphis,
} from './themes/index.js';

export { Form } from './components/Form.js';

export { FORM_SOUND_OPTIONS } from './utils/formSounds.js';

export {
  SLATE_IMAGE_INPUT_ACCEPT,
  SLATE_IMAGE_TYPE_HINT,
  inferImageMimeType,
  isLikelyImageFile,
  isHeicLike,
} from './utils/imageFileTypes.js';

export { normalizePickedImageFile } from './utils/heicToJpeg.js';

export { prepareImageForStorage } from './utils/prepareImageForStorage.js';
export { prepareFileForUpload, shouldOptimizeImage } from './utils/prepareFileForUpload.js';
export { withInferredFileMime, inferFileMimeType } from './utils/fileMimeTypes.js';
export {
  createFileUploadHandler,
  type FileUploadHandler,
  type CreateFileUploadHandlerOptions,
} from './utils/createFileUploadHandler.js';
export {
  resolveFileInputAccept,
  formatFileUploadError,
  isFileSizeError,
} from './utils/fileUploadAccept.js';
export {
  SLATE_FILE_REF_PREFIX,
  isFileUploadRef,
  describeFileUploadAnswer,
  formatBytes,
  type FileUploadMeta,
} from './utils/fileUploadRef.js';

export { checkSchema, type SchemaIssue } from './logic/schemaCheck.js';

/**
 * Identity helper that captures the literal types of a schema for downstream
 * inference. Wrap your schema in `defineSchema({ ... })` to get strongly-typed
 * `answers` in `<Form onSubmit>`.
 *
 * Uses a `const` type parameter so option values, question IDs, and `required`
 * flags are preserved as literals rather than widened to `string` / `boolean`.
 */
export function defineSchema<const S extends Schema<ReadonlyArray<Question>>>(schema: S): S {
  return schema;
}
