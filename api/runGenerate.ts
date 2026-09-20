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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Structured draft. Retries once with the validation error appended. */
export async function runGenerateForm(prompt: string): Promise<GeneratedForm> {
  const call = async (user: string) => {
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      schema: generatedFormSchema,
      schemaName: 'SlateForm',
      schemaDescription: 'A Slate conversational form draft using every editor question type.',
      system: GENERATE_SYSTEM_PROMPT,
      prompt: user,
    });
    return object;
  };

  try {
    return await call(prompt);
  } catch (first) {
    if (!NoObjectGeneratedError.isInstance(first)) throw first;
    try {
      return await call(`${prompt}\n\nThe previous draft failed validation:\n${errorMessage(first)}`);
    } catch (second) {
      throw new GenerateValidationError(
        `Could not build a valid form. ${errorMessage(second)}`.slice(0, 400),
      );
    }
  }
}
