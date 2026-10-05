import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QA pass (COPY-02, COPY-11, GAPV-X1, GAP-07): whatever the submit or unlock
// request gets back — a proxy's HTML page, a platform's JSON, an empty body —
// a respondent reads one plain sentence with the right next step. The raw
// reply goes to the console, never to the page.

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  getSubmitUrl: () => 'https://submit.invalid',
}));

import {
  FormClosedError,
  TooLongError,
  submitPublicResponse,
  unlockPublicForm,
} from '../examples/_admin/neon/publicApi.js';
import {
  FORM_UNAVAILABLE,
  GATE_LATER,
  GATE_OFFLINE,
  SEND_LATER,
  SEND_OFFLINE,
  aboutWait,
  readableOr,
} from '../examples/_admin/fillCopy.js';

const respond = (res: Response) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res),
  );

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

const failure = async (res: Response): Promise<Error> => {
  respond(res);
  return submitPublicResponse(payload).then(
    () => new Error('it resolved'),
    (e: unknown) => e as Error,
  );
};

const NGINX =
  '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>';

describe('submit failures never show the reply', () => {
  it.each([
    ['500 Server misconfigured', new Response('Server misconfigured', { status: 500 })],
    ['503 Temporarily unavailable', new Response('Temporarily unavailable', { status: 503 })],
    ['502 empty', new Response('', { status: 502 })],
    ['502 nginx HTML', new Response(NGINX, { status: 502 })],
    [
      '502 Envoy text',
      new Response(
        'upstream connect error or disconnect/reset before headers. reset reason: connection termination',
        { status: 502 },
      ),
    ],
    [
      '500 platform JSON',
      new Response(JSON.stringify({ error: 'FUNCTION_INVOCATION_FAILED', code: '500' }), {
        status: 500,
      }),
    ],
    ['400 Invalid JSON', new Response('Invalid JSON', { status: 400 })],
    ['404 from something else', new Response('Not Found', { status: 404 })],
  ])('%s → the Retry sentence, raw text only in the console', async (_name, res) => {
    const err = await failure(res);
    expect(err.message).toBe(SEND_LATER);
    expect(err.message).not.toMatch(/\d{3}|<|\{|misconfigured|upstream|invalid json/i);
    expect(consoleError).toHaveBeenCalled();
  });

  it('the Function’s own 404 means the form closed: the closed screen, no Retry', async () => {
    const err = await failure(new Response('Form not available', { status: 404 }));
    expect(err).toBeInstanceOf(FormClosedError);
    expect((err as FormClosedError).closed).toEqual({ reason: 'date', message: null });
  });

  it('413 is a TooLongError (the page sends them back to the longest answer)', async () => {
    const err = await failure(
      new Response(
        'Your answers are too long to send. Please shorten the longest answer and try again.',
        { status: 413 },
      ),
    );
    expect(err).toBeInstanceOf(TooLongError);
  });

  it('a platform 429 without JSON names the wait in minutes or hours, never seconds', async () => {
    const err = await failure(
      new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '3600' } }),
    );
    expect(err.message).toBe(
      'Too many responses from this network right now. Try again in about an hour, or switch to mobile data.',
    );
    expect(err.message).not.toMatch(/seconds/);
  });

  it('a 200 that isn’t the Function’s JSON (a captive portal) says it wasn’t sent', async () => {
    const err = await failure(new Response('<!doctype html><title>Log in to Wi-Fi</title>'));
    expect(err.message).toBe(SEND_OFFLINE);
  });

  it('a stored response resolves with its id', async () => {
    respond(new Response(JSON.stringify({ id: 's_9' })));
    await expect(submitPublicResponse(payload)).resolves.toEqual({ id: 's_9' });
  });
});

describe('password gate replies (COPY-11)', () => {
  it('a 200 HTML page says to check the connection instead of hanging', async () => {
    respond(new Response('<!doctype html><p>Sign in to the hotspot</p>'));
    await expect(unlockPublicForm('crew', { password: 'x' })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      message: GATE_OFFLINE,
    });
  });

  it('network failure, server failure and a gone form each read plainly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect((await unlockPublicForm('crew', { password: 'x' })) as { message: string }).toMatchObject({
      message: GATE_OFFLINE,
    });
    respond(new Response('Temporarily unavailable', { status: 503 }));
    expect(await unlockPublicForm('crew', { password: 'x' })).toMatchObject({ message: GATE_LATER });
    respond(new Response('Not found', { status: 404 }));
    expect(await unlockPublicForm('crew', { password: 'x' })).toMatchObject({
      message: FORM_UNAVAILABLE,
    });
  });
});

describe('fillCopy helpers', () => {
  it('aboutWait rounds to minutes, then hours', () => {
    expect(aboutWait(30)).toBe('about 1 minute');
    expect(aboutWait(300)).toBe('about 5 minutes');
    expect(aboutWait(3600)).toBe('about an hour');
    expect(aboutWait(3 * 3600 + 100)).toBe('about 3 hours');
    expect(aboutWait(Number.NaN)).toBe('about 1 minute');
  });

  it('readableOr keeps a server sentence and refuses markup, JSON and codes', () => {
    expect(readableOr('This form can’t accept more files right now.', 'x')).toBe(
      'This form can’t accept more files right now.',
    );
    expect(readableOr('<html>busy</html>', 'x')).toBe('x');
    expect(readableOr('{"error":"x"}', 'x')).toBe('x');
    expect(readableOr('Sign failed', 'x')).toBe('x');
    expect(readableOr('Invalid path shape', 'x')).toBe('x');
    expect(readableOr('Missing or invalid contentLength', 'x')).toBe('x');
    expect(readableOr(undefined, 'x')).toBe('x');
  });
});
