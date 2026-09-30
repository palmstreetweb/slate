import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-058 (C9): respondent pages never load the Neon SDK for uploads, never
// read stored files back, and learn a file's meta from the upload itself.

const neon = vi.hoisted(() => ({ imported: 0, getSession: vi.fn() }));

vi.mock('../examples/_admin/neon/config.js', () => ({
  isNeonConfigured: () => true,
  hasStorageSignUrl: () => true,
  getStorageSignUrl: () => 'https://sign.invalid',
  getSubmitUrl: () => 'https://submit.invalid',
}));
vi.mock('../examples/_admin/neon/env.js', () => {
  neon.imported += 1;
  return {
    getNeon: () => ({ auth: { getSession: neon.getSession } }),
  };
});
vi.mock('../examples/_admin/localFileStore.js', () => ({
  getLocalUploadMeta: async () => null,
  saveLocalUpload: async () => 'slate-file://local',
}));

import {
  getStorageContentBlob,
  getStorageDownloadUrl,
  getStorageUploadMeta,
  STORAGE_FULL_COPY,
  uploadToNeonStorage,
} from '../examples/_admin/storageUpload.js';
import { hostFileUpload } from '../examples/_admin/hostFileUpload.js';
import { resolveUploadMeta } from '../examples/_admin/resolveUploadMeta.js';
import { clearUploadContext, setUploadContext } from '../examples/_admin/uploadContext.js';

type Call = { url: string; init?: RequestInit };
let calls: Call[];

const signCalls = () => calls.filter((c) => c.url === 'https://sign.invalid');
const bodyOf = (c: Call) => JSON.parse(String(c.init?.body)) as { op: string };
const headersOf = (c: Call) => (c.init?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
  calls = [];
  clearUploadContext();
  neon.getSession.mockReset();
  neon.getSession.mockResolvedValue({ data: { session: { access_token: 'owner-token' } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === 'https://sign.invalid') {
        const op = bodyOf({ url, init }).op;
        if (op === 'upload') {
          return new Response(
            JSON.stringify({
              url: 'https://bucket.invalid/put',
              method: 'PUT',
              contentType: 'text/plain',
            }),
          );
        }
        if (op === 'meta')
          return new Response(JSON.stringify({ name: 'n', size: 1, mime: 'text/plain' }));
        if (op === 'download')
          return new Response(JSON.stringify({ url: 'https://bucket.invalid/get' }));
        return new Response('bytes');
      }
      return new Response(null, { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (name = 'note.txt') => new File(['hello'], name, { type: 'text/plain' });

describe('public uploads (respondent page)', () => {
  it('send no Authorization header, never call getSession, and fill the meta cache', async () => {
    const importedBefore = neon.imported;
    setUploadContext('f_public1', { scope: 'public' });
    const ref = await uploadToNeonStorage(file(), { scope: 'public', formId: 'f_public1' });
    expect(headersOf(signCalls()[0]!).Authorization).toBeUndefined();
    expect(neon.getSession).not.toHaveBeenCalled();
    expect(neon.imported).toBe(importedBefore);

    const before = calls.length;
    await expect(getStorageUploadMeta(ref)).resolves.toEqual({
      name: 'note.txt',
      size: 5,
      mime: 'text/plain',
    });
    expect(calls.length).toBe(before);
  });

  it('draft uploads still send the Bearer', async () => {
    await uploadToNeonStorage(file(), { scope: 'draft', formId: 'f_mine01' });
    expect(headersOf(signCalls()[0]!).Authorization).toBe('Bearer owner-token');
  });

  it('respondent pages never read stored files: null with zero fetches', async () => {
    setUploadContext('f_public1', { scope: 'public' });
    const ref = 'slate-file://storage:public/f_public1/0f8fad5b-d9cb-469f-a165-70867728950e/x.pdf';
    await expect(getStorageUploadMeta(ref)).resolves.toBeNull();
    await expect(getStorageDownloadUrl(ref)).resolves.toBeNull();
    await expect(getStorageContentBlob(ref)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    expect(neon.getSession).not.toHaveBeenCalled();
  });

  it('the studio (no scope) still fetches with Authorization', async () => {
    const ref = 'slate-file://storage:public/f_public1/0f8fad5b-d9cb-469f-a165-70867728950f/y.pdf';
    await getStorageUploadMeta(ref);
    await getStorageDownloadUrl(ref);
    await getStorageContentBlob(ref);
    expect(signCalls().map((c) => bodyOf(c).op)).toEqual(['meta', 'download', 'content']);
    for (const c of signCalls()) expect(headersOf(c).Authorization).toBe('Bearer owner-token');
  });

  it('PublicFill flow: 5 files added one at a time make 0 meta calls and 0 getSession calls', async () => {
    setUploadContext('f_public1', { scope: 'public' });
    const refs: string[] = [];
    for (let i = 0; i < 5; i++) {
      refs.push(String(await hostFileUpload(file(`f${i}.txt`), 'q_file')));
      // FileUploadField resolves every ref on each change.
      for (const r of refs) expect(await resolveUploadMeta(r)).not.toBeNull();
    }
    expect(signCalls().filter((c) => bodyOf(c).op === 'meta')).toHaveLength(0);
    expect(neon.getSession).not.toHaveBeenCalled();
  });

  it('a network failure on the sign request throws plain copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(
      uploadToNeonStorage(file(), { scope: 'public', formId: 'f_public1' }),
    ).rejects.toThrow('Couldn’t reach Slate. Check your connection and try again.');
  });
});

describe('server-minted keys and full storage (ADR-067)', () => {
  const KEY = 'public/f_public1/1f8fad5b-d9cb-469f-a165-70867728950e/note.txt';
  const signReplies = (reply: () => Response) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return url === 'https://sign.invalid' ? reply() : new Response(null, { status: 200 });
      }),
    );

  it('names the question, and stores the key the server picked', async () => {
    signReplies(
      () =>
        new Response(
          JSON.stringify({ url: 'https://bucket.invalid/put', method: 'PUT', key: KEY }),
        ),
    );
    const ref = await uploadToNeonStorage(file(), {
      scope: 'public',
      formId: 'f_public1',
      questionId: 'q_docs',
    });
    expect(bodyOf(signCalls()[0]!)).toMatchObject({ op: 'upload', questionId: 'q_docs' });
    expect(ref).toBe(`slate-file://storage:${KEY}`);
    // The PUT goes to the signed URL; nothing else is fetched.
    expect(calls.map((c) => c.url)).toEqual(['https://sign.invalid', 'https://bucket.invalid/put']);
  });

  it('a key for another form, or none (a storagesign from before), keeps the page’s own path', async () => {
    for (const key of ['public/f_other01/1f8fad5b-d9cb-469f-a165-70867728950e/x.txt', undefined]) {
      calls = [];
      signReplies(() => new Response(JSON.stringify({ url: 'https://bucket.invalid/put', key })));
      const ref = await uploadToNeonStorage(file(), { scope: 'public', formId: 'f_public1' });
      const asked = (bodyOf(signCalls()[0]!) as unknown as { path: string }).path;
      expect(ref).toBe(`slate-file://storage:${asked}`);
    }
  });

  it('507 shows the server’s sentence; anything odd falls back to the respondent copy', async () => {
    signReplies(
      () => new Response('This form can’t accept more files right now.', { status: 507 }),
    );
    await expect(
      uploadToNeonStorage(file(), { scope: 'public', formId: 'f_public1', questionId: 'q' }),
    ).rejects.toThrow('This form can’t accept more files right now.');
    signReplies(() => new Response('<html>busy</html>', { status: 507 }));
    await expect(
      uploadToNeonStorage(file(), { scope: 'public', formId: 'f_public1', questionId: 'q' }),
    ).rejects.toThrow(STORAGE_FULL_COPY);
  });
});
