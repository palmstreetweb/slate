/**
 * Public entry for `@palmstreetweb/forms`.
 *
 * Consumers should only import from this barrel — anything not re-exported
 * here is internal and may move between minor versions.
 */

import type { Question } from './types/Question.js';
import type { Schema } from './types/Schema.js';

export type * from './types/index.js';
export { isQuestionType } from './types/index.js';

export { themes, editorial, swiss } from './themes/index.js';

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
