// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiModule from 'ai';

const generateObject = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof AiModule>()),
  generateObject,
}));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ id }) }));

import { NoObjectGeneratedError } from 'ai';
import {
  GenerateTimeoutError,
  GenerateValidationError,
  MAX_OUTPUT_TOKENS,
  runGenerateForm,
} from '../api/runGenerate.js';

const FORM = { title: 'RSVP' };

function invalidDraft(): Error {
  return new NoObjectGeneratedError({
    message: 'No object generated: response did not match schema.',
    text: '{}',
    response: { id: 'r', timestamp: new Date(), modelId: 'm' },
    usage: {} as never,
    finishReason: 'stop',
  });
}

beforeEach(() => {
  generateObject.mockReset();
});

describe('runGenerateForm cost + time guards (audit H2 / M-AI-1)', () => {
  it('caps output tokens and SDK retries on every call', async () => {
    generateObject.mockResolvedValue({ object: FORM });
    await expect(runGenerateForm({ prompt: 'RSVP' })).resolves.toEqual(FORM);
    const opts = generateObject.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(16_000);
    expect(opts.maxRetries).toBe(1);
  });

  it('aborts the model call at the deadline', async () => {
    generateObject.mockResolvedValue({ object: FORM });
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
    generateObject.mockRejectedValueOnce(invalidDraft()).mockResolvedValueOnce({ object: FORM });
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
