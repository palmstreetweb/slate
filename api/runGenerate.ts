import { generateObject, NoObjectGeneratedError } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import {
  GENERATE_SYSTEM_PROMPT,
  generatedFormSchema,
  type GeneratedForm,
} from './generateFormSchema.js';

export class GenerateValidationError extends Error {
  constructor(message: string) {
    super(message);
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

export class GenerateTimeoutError extends Error {
  constructor() {
    super('That took too long. Try a shorter PDF or a shorter description.');
    this.name = 'GenerateTimeoutError';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildGenerateUserPrompt(input: GenerateInput): string {
  const prompt = input.prompt.trim();
  if (input.previous && input.instruction?.trim()) {
    return [
      `Original request:\n${prompt}`,
      `Revise this draft. Instruction: ${input.instruction.trim()}`,
      'Keep question ids stable when the question is the same.',
      'Use showIfField / showIfEquals for branches (plus-one, meal after yes, etc.).',
      `Current draft:\n${JSON.stringify(input.previous)}`,
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
  const call = async (text: string) => {
    const left = deadline === undefined ? undefined : deadline - Date.now();
    if (left !== undefined && left <= 0) throw new GenerateTimeoutError();
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // One SDK retry at most: each retry is a full model call against the deadline.
      maxRetries: 1,
      abortSignal: left === undefined ? undefined : AbortSignal.timeout(left),
      schema: generatedFormSchema,
      schemaName: 'SlateForm',
      schemaDescription:
        'A Slate conversational form draft. Prefer common question types; branching via showIfField.',
      system: GENERATE_SYSTEM_PROMPT,
      prompt: text,
    });
    return object;
  };

  const timedOut = (err: unknown, depth = 0): boolean =>
    err instanceof GenerateTimeoutError ||
    (err instanceof Error &&
      (err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        (depth < 2 && timedOut((err as { cause?: unknown }).cause, depth + 1))));

  try {
    return await call(user);
  } catch (first) {
    if (timedOut(first)) throw new GenerateTimeoutError();
    if (!NoObjectGeneratedError.isInstance(first)) throw first;
    if (deadline !== undefined && deadline - Date.now() < MIN_RETRY_MS) {
      throw new GenerateValidationError('Could not build a valid form. Try again.');
    }
    try {
      return await call(`${user}\n\nThe previous draft failed validation:\n${errorMessage(first)}`);
    } catch (second) {
      if (timedOut(second)) throw new GenerateTimeoutError();
      throw new GenerateValidationError(
        `Could not build a valid form. ${errorMessage(second)}`.slice(0, 400),
      );
    }
  }
}
