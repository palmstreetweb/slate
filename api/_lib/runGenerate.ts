import { APICallError, generateObject, NoObjectGeneratedError } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { GENERATE_SYSTEM_PROMPT, type GeneratedForm } from './generateFormSchema.js';
import { fromModelForm, modelFormSchema, toModelForm } from './modelForm.js';

/** What the owner reads when the model's draft didn't hold together, twice. */
export const GENERATE_VALIDATION_MESSAGE =
  'The AI couldn’t turn that into a form. Try again, or describe it a little differently.';

export class GenerateValidationError extends Error {
  constructor(cause?: unknown) {
    super(GENERATE_VALIDATION_MESSAGE, cause === undefined ? undefined : { cause });
    this.name = 'GenerateValidationError';
  }
}

export type GenerateInput = {
  prompt: string;
  previous?: GeneratedForm;
  instruction?: string;
  /** Epoch ms. The model call is aborted here so the route can answer before Vercel's 60 s kill. */
  deadline?: number;
};

/**
 * Ceiling on one draft. A long PDF form can legitimately need ~10k tokens;
 * without a cap the SDK allows 64k, which is a runaway-cost risk (audit H2).
 */
export const MAX_OUTPUT_TOKENS = 16_000;
/** Don't start the validation retry with less than this left before the deadline. */
const MIN_RETRY_MS = 15_000;
/** After Anthropic refuses the output schema, skip straight to tool mode for this long. */
const TOOL_MODE_MS = 6 * 60 * 60 * 1000;

export class GenerateTimeoutError extends Error {
  constructor() {
    super('That took too long. Try a shorter PDF or a shorter description.');
    this.name = 'GenerateTimeoutError';
  }
}

/** The model answered, but its draft didn't expand into a valid form. */
class DraftShapeError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'draft did not validate', { cause });
    this.name = 'DraftShapeError';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Anthropic compiles the output schema into a grammar and refuses one that is
 * too big ("The compiled grammar is too large…", "Schema is too complex for
 * compilation"). That happened in production once the draft shape grew.
 */
export function isSchemaCompileError(err: unknown): boolean {
  if (!APICallError.isInstance(err) || err.statusCode !== 400) return false;
  return /grammar|too complex|optional parameters|union types|strict tools/i.test(err.message);
}

let toolModeUntil = 0;

/** Test-only. */
export function resetGenerateMode(): void {
  toolModeUntil = 0;
}

export function buildGenerateUserPrompt(input: GenerateInput): string {
  const prompt = input.prompt.trim();
  if (input.previous && input.instruction?.trim()) {
    return [
      `Original request:\n${prompt}`,
      `Revise this draft. Instruction: ${input.instruction.trim()}`,
      'Keep question ids stable when the question is the same.',
      'Use showIfField / showIfEquals for branches (plus-one, meal after yes, etc.).',
      // In the shape the model writes, so it edits rather than translates.
      `Current draft:\n${JSON.stringify(toModelForm(input.previous))}`,
    ].join('\n\n');
  }
  return prompt;
}

function normalizeInput(input: string | GenerateInput): GenerateInput {
  return typeof input === 'string' ? { prompt: input } : input;
}

/** Structured draft. Retries once with the validation error appended. */
export async function runGenerateForm(input: string | GenerateInput): Promise<GeneratedForm> {
  const args = normalizeInput(input);
  const user = buildGenerateUserPrompt(args);
  const deadline = args.deadline;

  const once = async (text: string, toolMode: boolean): Promise<GeneratedForm> => {
    const left = deadline === undefined ? undefined : deadline - Date.now();
    if (left !== undefined && left <= 0) throw new GenerateTimeoutError();
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // One SDK retry at most: each retry is a full model call against the deadline.
      maxRetries: 1,
      abortSignal: left === undefined ? undefined : AbortSignal.timeout(left),
      schema: modelFormSchema,
      schemaName: 'SlateForm',
      schemaDescription:
        'A Slate conversational form draft. Prefer common question types; branching via showIfField.',
      system: GENERATE_SYSTEM_PROMPT,
      prompt: text,
      // Tool mode skips the grammar: the model writes the same JSON, and the
      // schema is still checked here before anything is returned.
      ...(toolMode ? { providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } } } : {}),
    });
    try {
      return fromModelForm(object);
    } catch (err) {
      throw new DraftShapeError(err);
    }
  };

  const call = async (text: string): Promise<GeneratedForm> => {
    const toolMode = Date.now() < toolModeUntil;
    try {
      return await once(text, toolMode);
    } catch (err) {
      if (toolMode || !isSchemaCompileError(err)) throw err;
      // Build with AI keeps working while the schema is too big to compile;
      // the log says so, so it gets fixed rather than hidden.
      toolModeUntil = Date.now() + TOOL_MODE_MS;
      console.warn(
        '[slate] generate: Anthropic refused the output schema, using tool mode:',
        errorMessage(err),
      );
      return once(text, true);
    }
  };

  const timedOut = (err: unknown, depth = 0): boolean =>
    err instanceof GenerateTimeoutError ||
    (err instanceof Error &&
      (err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        (depth < 2 && timedOut((err as { cause?: unknown }).cause, depth + 1))));

  const invalidDraft = (err: unknown) =>
    NoObjectGeneratedError.isInstance(err) || err instanceof DraftShapeError;

  try {
    return await call(user);
  } catch (first) {
    if (timedOut(first)) throw new GenerateTimeoutError();
    if (!invalidDraft(first)) throw first;
    if (deadline !== undefined && deadline - Date.now() < MIN_RETRY_MS) {
      throw new GenerateValidationError(first);
    }
    try {
      return await call(`${user}\n\nThe previous draft failed validation:\n${errorMessage(first)}`);
    } catch (second) {
      if (timedOut(second)) throw new GenerateTimeoutError();
      if (!invalidDraft(second)) throw second;
      throw new GenerateValidationError(second);
    }
  }
}
