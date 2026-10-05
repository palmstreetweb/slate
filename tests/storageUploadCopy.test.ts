import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QA pass (COPY-03, MEDIA-06): an upload that fails reads as one plain
// sentence — never storagesign's labels ("Sign failed", "Invalid path shape",
// "Missing or invalid contentLength") or object storage's XML.

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  hasStorageSignUrl: () => true,
  getStorageSignUrl: () => 'https://sign.invalid',
  getSubmitUrl: () => 'https://submit.invalid',
}));

import { UPLOAD_COPY, uploadToNeonStorage } from '../examples/_admin/storageUpload.js';
import { FILE_EMPTY, FORM_UNAVAILABLE } from '../examples/_admin/fillCopy.js';
import { formatFileUploadError } from '../src/utils/fileUploadAccept.js';

const SIGN = 'https://sign.invalid';
const file = (body = 'hello', name = 'note.txt') => new File([body], name, { type: 'text/plain' });
const opts = { scope: 'public' as const, formId: 'f_public1', questionId: 'q_docs' };

let calls: string[];
let consoleError: ReturnType<typeof vi.spyOn>;

/** storagesign answers `sign`; the bucket answers `put`. */
function server(
  sign: () => Response,
  put: () => Response | Promise<Response> = () => new Response(''),
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url === SIGN ? sign() : put();
    }),
  );
}

const signOk = () =>
  new Response(
    JSON.stringify({ url: 'https://bucket.invalid/put', method: 'PUT', contentType: 'text/plain' }),
  );

beforeEach(() => {
  calls = [];
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const failure = (f = file()) =>
  uploadToNeonStorage(f, opts).catch((e: unknown) => (e as Error).message);

describe('sign refusals', () => {
  it.each([
    ['500 Sign failed', 500, 'Sign failed'],
    ['400 Invalid path shape', 400, 'Invalid path shape'],
    ['400 Invalid fields', 400, 'Invalid fields'],
    ['503 Temporarily unavailable', 503, 'Temporarily unavailable'],
    ['502 HTML', 502, '<html><body>Bad gateway</body></html>'],
  ])('%s → try again in a moment', async (_n, status, body) => {
    server(() => new Response(body, { status }));
    expect(await failure()).toBe(UPLOAD_COPY.later);
    expect(consoleError).toHaveBeenCalled();
  });

  it('storagesign’s own sentences for a stale page and a lost race read as sent', async () => {
    server(
      () => new Response('This page is out of date. Reload it to add files.', { status: 400 }),
    );
    expect(await failure()).toBe('This page is out of date. Reload it to add files.');
    server(() => new Response('That upload didn’t go through. Please try again.', { status: 409 }));
    expect(await failure()).toBe('That upload didn’t go through. Please try again.');
  });

  it('413 names the question’s limit in the one “too big” sentence', async () => {
    server(() => new Response('File too large (max 5 MB)', { status: 413 }));
    expect(await failure()).toBe('That file is too big. The limit is 5 MB.');
    server(() => new Response('Payload too large', { status: 413 }));
    expect(await failure()).toBe(UPLOAD_COPY.tooBig);
  });

  it('401: a respondent is asked for the password, an owner to sign in again', async () => {
    server(() => new Response(JSON.stringify({ error: 'locked' }), { status: 401 }));
    expect(await failure()).toBe(UPLOAD_COPY.locked);
    server(() => new Response('Unauthorized', { status: 401 }));
    const owner = await uploadToNeonStorage(file(), { ...opts, scope: 'draft' }).catch(
      (e: unknown) => (e as Error).message,
    );
    expect(owner).toBe(UPLOAD_COPY.signedOut);
  });

  it('404 says the form isn’t taking responses', async () => {
    server(() => new Response('Form not available', { status: 404 }));
    expect(await failure()).toBe(FORM_UNAVAILABLE);
  });

  it('a platform 429 names the wait in minutes, never seconds', async () => {
    server(() => new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } }));
    expect(await failure()).toBe(
      'Too many uploads from this network right now. Try again in about 2 minutes, or switch to mobile data.',
    );
  });

  it('a 200 that isn’t storagesign’s JSON says to check the connection', async () => {
    server(() => new Response('<!doctype html><p>Wi-Fi login</p>'));
    expect(await failure()).toBe(UPLOAD_COPY.offline);
  });
});

describe('the upload itself', () => {
  it('an empty file is refused before anything is sent', async () => {
    server(signOk);
    expect(await failure(file(''))).toBe(FILE_EMPTY);
    expect(calls).toHaveLength(0);
  });

  it('a refused PUT never shows the XML', async () => {
    server(
      signOk,
      () =>
        new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>RequestTimeTooSkewed</Code><Message>The difference between the request time and the current time is too large.</Message></Error>',
          { status: 403 },
        ),
    );
    const message = await failure();
    expect(message).toBe(UPLOAD_COPY.put);
    expect(message).not.toMatch(/xml|403|Skewed/i);
    // The field shows it as written — it no longer reads as a connection problem.
    expect(formatFileUploadError(new Error(message))).toBe(UPLOAD_COPY.put);
  });

  it('a PUT the network drops says to check the connection', async () => {
    server(signOk, () => {
      throw new TypeError('Load failed');
    });
    expect(await failure()).toBe(UPLOAD_COPY.offline);
  });
});
