// @vitest-environment node
/**
 * Build with AI never shows raw SDK / Anthropic / platform text (QA COPY-07,
 * S19, X1). The route words every failure and says whether Retry can help;
 * the client words what the route never saw (offline, a platform timeout).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type * as RunGenerate from '../api/runGenerate.js';

const runGenerateForm = vi.hoisted(() => vi.fn());
vi.mock('../api/runGenerate.js', async (importOriginal) => ({
  ...(await importOriginal<typeof RunGenerate>()),
  runGenerateForm,
}));
vi.mock('../examples/_admin/storageUpload.js', () => ({ authHeader: async () => ({}) }));

import { APICallError, RetryError } from 'ai';
import handler, {
  AI_BROKEN_MESSAGE,
  AI_BUSY_MESSAGE,
  AI_FAILED_MESSAGE,
  classifyGenerateError,
} from '../api/generate.js';
import { GENERATE_VALIDATION_MESSAGE, GenerateValidationError } from '../api/runGenerate.js';
import { resetRateLimit } from '../api/rateLimit.js';
import {
  GenerateRequestError,
  localResetPhrase,
  requestGeneratedForm,
} from '../examples/_admin/ai/client.js';
import { fromModelForm } from '../api/_modelForm.js';

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
const FORM = fromModelForm({
  title: 'RSVP',
  description: 'Who is coming.',
  theme: 'editorial',
  welcome: { title: 'Welcome.', subtitle: '', cta: 'Start' },
  questions: [
    { ...blank, id: 'name', type: 'short_text', title: 'Name?' },
    { ...blank, id: 'email', type: 'email', title: 'Email?' },
    { ...blank, id: 'coming', type: 'yes_no', title: 'Coming?' },
  ],
  thanks: { title: 'Thanks.', subtitle: '', cta: 'Done' },
  estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
});

function apiError(statusCode: number | undefined, message: string) {
  return new APICallError({
    message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode === undefined || statusCode >= 500,
  });
}

/** Dev-bypass request: no JWT or quota, straight to the model call. */
function devPost(body: Record<string, unknown> = { prompt: 'Wedding RSVP' }): Request {
  return new Request('http://127.0.0.1/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-slate-dev': '1' },
    body: JSON.stringify(body),
  });
}

const call = async (req: Request) => (await handler(req)) as Response;

/** Developer words that must never reach an owner. */
const RAW =
  /Overloaded|x-api-key|authentication_error|NoObjectGenerated|schema|grammar|Failed after|Generate failed|\{|\(\d{3}\)|undefined|JSON/;

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetRateLimit();
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  runGenerateForm.mockReset().mockResolvedValue(FORM);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('/api/generate words every model failure', () => {
  it.each([
    [
      'Anthropic overloaded twice',
      new RetryError({
        message: 'Failed after 2 attempts. Last error: Overloaded',
        reason: 'maxRetriesExceeded',
        errors: [apiError(529, 'Overloaded'), apiError(529, 'Overloaded')],
      }),
      503,
      AI_BUSY_MESSAGE,
      true,
    ],
    ['a 5xx', apiError(500, 'Internal server error'), 503, AI_BUSY_MESSAGE, true],
    [
      'Anthropic unreachable',
      apiError(undefined, 'Cannot connect to API: fetch failed'),
      503,
      AI_BUSY_MESSAGE,
      true,
    ],
    [
      'a bad key',
      apiError(
        401,
        '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      ),
      503,
      AI_BROKEN_MESSAGE,
      false,
    ],
    [
      'no credit',
      apiError(400, 'Your credit balance is too low to access the Anthropic API.'),
      503,
      AI_BROKEN_MESSAGE,
      false,
    ],
    [
      'a schema it will not compile',
      apiError(400, 'The compiled grammar is too large, which would cause performance issues.'),
      502,
      AI_BROKEN_MESSAGE,
      false,
    ],
    ['anything else', new Error('Connection error.'), 502, AI_FAILED_MESSAGE, true],
  ])('%s', async (_label, err, status, message, retry) => {
    runGenerateForm.mockRejectedValue(err);
    const res = await call(devPost());
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toEqual({ error: message, retry });
    expect(body.error).not.toMatch(RAW);
    // The raw text stays in the server log for debugging.
    expect(errorSpy).toHaveBeenCalled();
  });

  it('a draft that never validated asks for a retry in plain words', async () => {
    runGenerateForm.mockRejectedValue(
      new GenerateValidationError(new Error('No object generated')),
    );
    const res = await call(devPost());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: GENERATE_VALIDATION_MESSAGE, retry: true });
  });

  it('classifies a RetryError without an API error as busy', () => {
    expect(
      classifyGenerateError(
        new RetryError({
          message: 'Failed after 2 attempts',
          reason: 'maxRetriesExceeded',
          errors: [],
        }),
      ),
    ).toEqual({ status: 503, error: AI_BUSY_MESSAGE, retry: true });
  });
});

describe('/api/generate input answers are plain too', () => {
  it.each([
    [{ prompt: 'x'.repeat(2001) }, /under 2,000 characters/],
    [{ prompt: 'RSVP', instruction: 'x'.repeat(801) }, /under 800 characters/],
    [{ prompt: '' }, /Describe the form/],
    [
      { prompt: 'RSVP', document: { filename: 'brief.docx', base64: 'AAAA' } },
      /^Only PDFs work here for now\./,
    ],
    [{ prompt: 'RSVP', document: 'nope' }, /didn’t come through/],
    [{ prompt: 'RSVP', previous: 'nope', instruction: 'Shorter' }, /Start over/],
    [{ prompt: 'RSVP', instruction: 'Shorter' }, /Start over/],
  ])('%#', async (body, message) => {
    const res = await call(devPost(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(message);
    expect(json.error).not.toMatch(/previous|document|generate\b/);
    expect(json.retry).toBe(false);
  });

  it('a body that is not JSON', async () => {
    const res = await call(
      new Request('http://127.0.0.1/api/generate', {
        method: 'POST',
        headers: { 'x-slate-dev': '1' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Something went wrong sending that. Reload the page and try again.',
    );
  });

  it('a host without the AI key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await call(devPost());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Build with AI isn’t available here.',
      retry: false,
    });
  });
});

describe('the studio client never shows a raw error', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  const failure = async () =>
    (await requestGeneratedForm({ prompt: 'RSVP' }).catch(
      (e: unknown) => e,
    )) as GenerateRequestError;

  it('offline: “Can’t reach Slate”, with Retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await failure();
    expect(err).toBeInstanceOf(GenerateRequestError);
    expect(err.message).toBe('Can’t reach Slate. Check your connection and try again.');
    expect(err.retryable).toBe(true);
  });

  it('a platform timeout page: “That took too long”, with Retry', async () => {
    fetchMock.mockResolvedValue(new Response('<html>An error occurred</html>', { status: 504 }));
    const err = await failure();
    expect(err.message).toBe('That took too long. Try a shorter description or a smaller PDF.');
    expect(err.retryable).toBe(true);
  });

  it('a platform error page: plain, with Retry', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = await failure();
    expect(err.message).toBe('Build with AI isn’t working right now. Try again in a minute.');
    expect(err.retryable).toBe(true);
  });

  it('an answer without a form', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const err = await failure();
    expect(err.message).toBe('Couldn’t build a form from that. Try describing it differently.');
    expect(err.message).not.toMatch(/\(\d{3}\)/);
  });

  it('keeps the route’s own words and its retry hint', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: AI_BROKEN_MESSAGE, retry: false }), { status: 503 }),
    );
    const err = await failure();
    expect(err.message).toBe(AI_BROKEN_MESSAGE);
    expect(err.retryable).toBe(false);
  });

  it('a string error that reads like a log line is not shown (copy QA)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const raw of [
      'Failed after 2 attempts. Last error: Overloaded',
      'TypeError: x is undefined',
      'upstream status 529',
    ]) {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: raw, retry: true }), { status: 500 }),
      );
      const err = await failure();
      expect(err.message).toBe('Build with AI isn’t working right now. Try again in a minute.');
    }
    // The route's own sentences still go through as written.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Keep the description under 2,000 characters.', retry: false }),
        { status: 400 },
      ),
    );
    expect((await failure()).message).toBe('Keep the description under 2,000 characters.');
  });

  it('a JSON error that is not ours is not shown', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'FUNCTION_INVOCATION_FAILED', message: 'x' } }),
        {
          status: 500,
        },
      ),
    );
    const err = await failure();
    expect(err.message).toBe('Build with AI isn’t working right now. Try again in a minute.');
  });

  it('end to end through the route: an overloaded model reads as busy', async () => {
    runGenerateForm.mockRejectedValue(apiError(529, 'Overloaded'));
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      call(
        new Request(`http://127.0.0.1${url}`, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), 'x-slate-dev': '1' },
        }),
      ),
    );
    const err = await failure();
    expect(err.message).toBe(AI_BUSY_MESSAGE);
    expect(err.retryable).toBe(true);
  });
});

describe('the daily reset in local time', () => {
  it('same day, next day, and nonsense', () => {
    const now = new Date(2026, 9, 4, 9, 0);
    const later = new Date(2026, 9, 4, 17, 0);
    const tomorrow = new Date(2026, 9, 5, 2, 0);
    expect(localResetPhrase(later.toISOString(), now)).toMatch(/^after .+ today$/);
    expect(localResetPhrase(tomorrow.toISOString(), now)).toMatch(/^tomorrow after .+$/);
    expect(localResetPhrase('soon', now)).toBeNull();
    expect(localResetPhrase(undefined, now)).toBeNull();
    expect(localResetPhrase(new Date(2026, 9, 3).toISOString(), now)).toBeNull();
  });
});
