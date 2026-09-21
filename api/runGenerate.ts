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
};

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
  const call = async (text: string) => {
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      schema: generatedFormSchema,
      schemaName: 'SlateForm',
      schemaDescription:
        'A Slate conversational form draft. Prefer common question types; branching via showIfField.',
      system: GENERATE_SYSTEM_PROMPT,
      prompt: text,
    });
    return object;
  };

  try {
    return await call(user);
  } catch (first) {
    if (!NoObjectGeneratedError.isInstance(first)) throw first;
    try {
      return await call(`${user}\n\nThe previous draft failed validation:\n${errorMessage(first)}`);
    } catch (second) {
      throw new GenerateValidationError(
        `Could not build a valid form. ${errorMessage(second)}`.slice(0, 400),
      );
    }
  }
}
