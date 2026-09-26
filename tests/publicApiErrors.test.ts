import { afterEach, describe, expect, it, vi } from 'vitest';

// ADR-058 (C9): the unlock 429 shows the server's wait, and network failures
// read as plain copy instead of "Failed to fetch".

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  getSubmitUrl: () => 'https://submit.invalid',
}));

import { submitPublicResponse, unlockPublicForm } from '../examples/_admin/neon/publicApi.js';

const respond = (res: Response) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res),
  );

afterEach(() => vi.unstubAllGlobals());

const payload = {
  formId: 'f_1',
  answers: {},
  meta: {
    startedAt: 'a',
    completedAt: 'b',
    durationMs: 1,
    questionsVisited: [],
    hiddenFields: {},
  },
};

describe('unlockPublicForm 429', () => {
  it('shows the server text when it starts with Too many', async () => {
    const error =
      'Too many wrong passwords from this network. Check the password with whoever shared the form, or try again in about 60 minutes.';
    respond(new Response(JSON.stringify({ error, retryAfterSeconds: 3600 }), { status: 429 }));
    await expect(unlockPublicForm('crew', { password: 'x' })).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      message: error,
    });
  });

  it('uses retryAfterSeconds from the body when the header is hidden', async () => {
    respond(new Response(JSON.stringify({ retryAfterSeconds: 3600 }), { status: 429 }));
    const r = await unlockPublicForm('crew', { password: 'x' });
    expect(r).toMatchObject({ message: 'Too many tries. Please wait about 60 minutes.' });
  });

  it('a non-JSON body with no header says about 1 minute', async () => {
    respond(new Response('nope', { status: 429 }));
    const r = await unlockPublicForm('crew', { password: 'x' });
    expect(r).toMatchObject({ message: 'Too many tries. Please wait about 1 minute.' });
  });
});

describe('submitPublicResponse', () => {
  it('a network failure throws the Couldn’t reach Slate copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(submitPublicResponse(payload)).rejects.toThrow(
      'Couldn’t reach Slate. Check your connection and press Retry — your answers are still here.',
    );
  });

  it('a 429 still shows the server text as sent', async () => {
    const error =
      'Too many responses from this network right now. Please wait about 5 minutes, or try from another network (for example mobile data).';
    respond(new Response(JSON.stringify({ error, retryAfterSeconds: 300 }), { status: 429 }));
    await expect(submitPublicResponse(payload)).rejects.toThrow(error);
  });
});
