import { afterEach, describe, expect, it, vi } from 'vitest';

// ADR-058 (C9): the unlock 429 shows the server's wait, and network failures
// read as plain copy instead of "Failed to fetch".

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  getSubmitUrl: () => 'https://submit.invalid',
}));

import {
  FilesRejectedError,
  newSubmitId,
  submitPublicResponse,
  unlockPublicForm,
} from '../examples/_admin/neon/publicApi.js';

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
    expect(r).toMatchObject({
      message:
        'Too many password attempts from this network right now. Please wait about an hour, or try from another network (for example mobile data).',
    });
  });

  it('a non-JSON body with no header says about 1 minute', async () => {
    respond(new Response('nope', { status: 429 }));
    const r = await unlockPublicForm('crew', { password: 'x' });
    expect(r).toMatchObject({
      message:
        'Too many password attempts from this network right now. Please wait about 1 minute, or try from another network (for example mobile data).',
    });
  });
});

describe('submitPublicResponse', () => {
  it('a network failure says the answers weren’t sent, and that they’re still here', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(submitPublicResponse(payload)).rejects.toThrow(
      'Your answers weren’t sent. Check your connection and press Retry — your answers are still here.',
    );
  });

  it('a 429 still shows the server text as sent', async () => {
    const error =
      'Too many responses from this network right now. Please wait about 5 minutes, or try from another network (for example mobile data).';
    respond(new Response(JSON.stringify({ error, retryAfterSeconds: 300 }), { status: 429 }));
    await expect(submitPublicResponse(payload)).rejects.toThrow(error);
  });

  it('sends the fill’s submitId (ADR-067)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 's_1' })));
    vi.stubGlobal('fetch', fetch);
    const submitId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await submitPublicResponse({ ...payload, submitId });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ formId: 'f_1', submitId });
  });

  it('a 400 about files is a FilesRejectedError naming the questions; other 400s never show their text', async () => {
    const error = 'A file you added expired or didn’t finish uploading.';
    respond(
      new Response(JSON.stringify({ error, reason: 'files', questions: ['docs', 7] }), {
        status: 400,
      }),
    );
    const err = await submitPublicResponse(payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FilesRejectedError);
    expect((err as FilesRejectedError).message).toBe(error);
    expect((err as FilesRejectedError).questions).toEqual(['docs']);
    // COPY-02: the Function's 'Missing fields' is for developers, not respondents.
    respond(new Response('Missing fields', { status: 400 }));
    await expect(submitPublicResponse(payload)).rejects.toThrow(
      'We couldn’t send your answers just now. Press Retry in a moment — your answers are still here.',
    );
  });

  it('newSubmitId is a lowercase UUID', () => {
    expect(newSubmitId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
