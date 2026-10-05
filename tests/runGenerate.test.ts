// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiModule from 'ai';

const generateObject = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof AiModule>()),
  generateObject,
}));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ id }) }));

import { APICallError, NoObjectGeneratedError } from 'ai';
import {
  GENERATE_VALIDATION_MESSAGE,
  GenerateTimeoutError,
  GenerateValidationError,
  MAX_OUTPUT_TOKENS,
  isSchemaCompileError,
  resetGenerateMode,
  runGenerateForm,
} from '../api/runGenerate.js';
import { fromModelForm, modelFormSchema, type ModelForm } from '../api/_modelForm.js';

const blank = {
  text: '',
  required: false,
  min: 0,
  max: 0,
  step: 0,
  options: [],
  labels: [],
  settings: [],
  showIfField: '',
  showIfEquals: '',
};

/** What the model writes (api/_modelForm.ts). */
const MODEL_FORM: ModelForm = {
  title: 'RSVP',
  description: 'Who is coming.',
  theme: 'editorial',
  welcome: { title: 'You’re invited.', subtitle: '', cta: 'Start' },
  questions: [
    {
      ...blank,
      id: 'name',
      type: 'short_text',
      title: 'Your name?',
      text: 'Jordan',
      required: true,
    },
    { ...blank, id: 'coming', type: 'yes_no', title: 'Coming?', labels: ['Yes', 'No'] },
    { ...blank, id: 'notes', type: 'long_text', title: 'Anything else?' },
  ],
  thanks: { title: 'Thank you.', subtitle: '', cta: 'Done' },
  estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
};
/** What the studio gets back: the full draft. */
const FORM = fromModelForm(MODEL_FORM);

function invalidDraft(): Error {
  return new NoObjectGeneratedError({
    message: 'No object generated: response did not match schema.',
    text: '{}',
    response: { id: 'r', timestamp: new Date(), modelId: 'm' },
    usage: {} as never,
    finishReason: 'stop',
  });
}

function apiError(statusCode: number, message: string): Error {
  return new APICallError({
    message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
}

const GRAMMAR_TOO_LARGE =
  'The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.';

beforeEach(() => {
  generateObject.mockReset();
  resetGenerateMode();
});

describe('runGenerateForm cost + time guards (audit H2 / M-AI-1)', () => {
  it('caps output tokens and SDK retries on every call', async () => {
    generateObject.mockResolvedValue({ object: MODEL_FORM });
    await expect(runGenerateForm({ prompt: 'RSVP' })).resolves.toEqual(FORM);
    const opts = generateObject.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(16_000);
    expect(opts.maxRetries).toBe(1);
  });

  it('asks the model for the small shape, not the full draft', async () => {
    generateObject.mockResolvedValue({ object: MODEL_FORM });
    await runGenerateForm({ prompt: 'RSVP' });
    const opts = generateObject.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.schema).toBe(modelFormSchema);
    expect(opts).not.toHaveProperty('providerOptions');
  });

  it('aborts the model call at the deadline', async () => {
    generateObject.mockResolvedValue({ object: MODEL_FORM });
    await runGenerateForm({ prompt: 'RSVP', deadline: Date.now() + 60_000 });
    const { abortSignal } = generateObject.mock.calls[0]![0] as { abortSignal?: AbortSignal };
    expect(abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('never calls the model once the deadline has passed', async () => {
    await expect(
      runGenerateForm({ prompt: 'RSVP', deadline: Date.now() - 1 }),
    ).rejects.toBeInstanceOf(GenerateTimeoutError);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('turns an abort into a friendly timeout, and does not retry it', async () => {
    const abort = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    generateObject.mockRejectedValue(abort);
    await expect(
      runGenerateForm({ prompt: 'RSVP', deadline: Date.now() + 60_000 }),
    ).rejects.toThrow(/took too long/);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('retries a schema miss once when there is time', async () => {
    generateObject
      .mockRejectedValueOnce(invalidDraft())
      .mockResolvedValueOnce({ object: MODEL_FORM });
    await expect(
      runGenerateForm({ prompt: 'RSVP', deadline: Date.now() + 60_000 }),
    ).resolves.toEqual(FORM);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('skips the retry when the deadline is too close', async () => {
    generateObject.mockRejectedValue(invalidDraft());
    await expect(
      runGenerateForm({ prompt: 'RSVP', deadline: Date.now() + 5_000 }),
    ).rejects.toBeInstanceOf(GenerateValidationError);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});

describe('plain failures (QA COPY-07)', () => {
  it('two bad drafts end in one plain sentence, never the SDK text', async () => {
    generateObject.mockRejectedValue(invalidDraft());
    const err = await runGenerateForm({ prompt: 'RSVP', deadline: Date.now() + 60_000 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GenerateValidationError);
    expect((err as Error).message).toBe(GENERATE_VALIDATION_MESSAGE);
    expect((err as Error).message).not.toMatch(/schema|object generated/i);
  });

  it('a draft that does not expand counts as a miss and gets the one retry', async () => {
    generateObject
      .mockResolvedValueOnce({ object: { ...MODEL_FORM, questions: [] } })
      .mockResolvedValueOnce({ object: MODEL_FORM });
    await expect(
      runGenerateForm({ prompt: 'RSVP', deadline: Date.now() + 60_000 }),
    ).resolves.toEqual(FORM);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('passes API errors through for the route to word, without wrapping them', async () => {
    const overloaded = apiError(529, 'Overloaded');
    generateObject.mockRejectedValue(overloaded);
    await expect(runGenerateForm({ prompt: 'RSVP' })).rejects.toBe(overloaded);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});

describe('a schema Anthropic will not compile (QA X1)', () => {
  it('recognizes the grammar errors, and only those', () => {
    expect(isSchemaCompileError(apiError(400, GRAMMAR_TOO_LARGE))).toBe(true);
    expect(isSchemaCompileError(apiError(400, 'Schema is too complex for compilation.'))).toBe(
      true,
    );
    expect(isSchemaCompileError(apiError(400, 'prompt is too long'))).toBe(false);
    expect(isSchemaCompileError(apiError(529, 'Overloaded'))).toBe(false);
    expect(isSchemaCompileError(new Error(GRAMMAR_TOO_LARGE))).toBe(false);
  });

  it('falls back to tool mode once, and keeps using it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateObject
      .mockRejectedValueOnce(apiError(400, GRAMMAR_TOO_LARGE))
      .mockResolvedValue({ object: MODEL_FORM });
    await expect(runGenerateForm({ prompt: 'RSVP' })).resolves.toEqual(FORM);
    expect(generateObject).toHaveBeenCalledTimes(2);
    const second = generateObject.mock.calls[1]![0] as Record<string, unknown>;
    expect(second.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'jsonTool' } });
    expect(second.schema).toBe(modelFormSchema);
    expect(warn).toHaveBeenCalled();

    // The next draft skips the failing round trip.
    await runGenerateForm({ prompt: 'RSVP' });
    expect(generateObject).toHaveBeenCalledTimes(3);
    const third = generateObject.mock.calls[2]![0] as Record<string, unknown>;
    expect(third.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'jsonTool' } });
    warn.mockRestore();
  });

  it('does not loop when tool mode fails too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refused = apiError(400, GRAMMAR_TOO_LARGE);
    generateObject.mockRejectedValue(refused);
    await expect(runGenerateForm({ prompt: 'RSVP' })).rejects.toBe(refused);
    expect(generateObject).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
