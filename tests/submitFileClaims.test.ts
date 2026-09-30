/** @vitest-environment node */
/**
 * ADR-067: a response may only reference uploads storagesign minted for its
 * form and question that nobody has claimed; the insert checks and claims them
 * in one transaction (migration 021, emulated by _fnDb). A retried submit with
 * the same submitId gets the response it already stored.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addUpload, resetFnDb, type newFnDbState, type UploadRow } from './_fnDb.js';
import { fileClaimsOf, foreignRefQuestions } from '../neon/functions/submit-response/fileClaims.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const FORM = 'f_claimform01';
const OTHER = 'f_otherform01';
const OWNER = 'u_owner_claim';
const IP = '203.0.113.67';
const key = (name = 'photo.jpg', form = FORM, scope = 'public') =>
  `${scope}/${form}/${crypto.randomUUID()}/${name}`;
const ref = (k: string) => `slate-file://storage:${k}`;

const schema = {
  questions: [
    { id: 'name', type: 'short_text', title: 'Name' },
    { id: 'docs', type: 'file_upload', title: 'Docs' },
    { id: 'more', type: 'file_upload', title: 'More' },
    { id: 'story', type: 'voice_note', title: 'Story' },
    {
      id: 'shots',
      type: 'photo_checklist',
      title: 'Shots',
      items: [
        { label: 'Front', value: 'front' },
        { label: 'Back', value: 'back' },
      ],
    },
  ],
};

let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
let FILES_COPY: string;
const savedDb = process.env.DATABASE_URL;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  const mod = await import('../neon/functions/submit-response/index.js');
  app = mod.default;
  FILES_COPY = mod.FILES_COPY;
});

afterAll(() => {
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
});

beforeEach(() => {
  resetFnDb(db.state);
  db.state.forms.set(FORM, {
    id: FORM,
    name: 'Claims',
    slug: '23456789',
    status: 'published',
    deleted_at: null,
    owner_id: OWNER,
    fill_password_hash: null,
    published_schema: schema,
  });
});

const meta = {
  startedAt: '2026-09-30T10:00:00.000Z',
  completedAt: '2026-09-30T10:02:00.000Z',
  durationMs: 120000,
  questionsVisited: [],
  hiddenFields: {},
};
const submit = (answers: Record<string, unknown>, submitId?: unknown) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
    body: JSON.stringify({
      formId: FORM,
      answers,
      meta,
      ...(submitId === undefined ? {} : { submitId }),
    }),
  });
const upload = (question: string | null, extra: Partial<UploadRow> = {}) =>
  addUpload(db.state, { key: key(), owner_id: OWNER, question_id: question, ...extra }).key;

describe('fileClaimsOf / foreignRefQuestions (pure)', () => {
  it('every ref of this form in the kept answers, with its question, once', () => {
    const a = key();
    const b = key('v.webm');
    const c = key('front.jpg');
    expect(
      fileClaimsOf(
        {
          name: 'Ada',
          docs: [ref(a), ref(a)],
          story: { audio: ref(b), sec: '4' },
          shots: { front: ref(c) },
          more: [ref(key('x.jpg', OTHER))],
        },
        FORM,
      ),
    ).toEqual([
      { key: a, question: 'docs' },
      { key: b, question: 'story' },
      { key: c, question: 'shots' },
    ]);
  });

  it('another form’s ref in a file question is foreign; in a text answer it is just text', () => {
    const theirs = ref(key('x.jpg', OTHER));
    expect(
      foreignRefQuestions(
        {
          name: theirs,
          docs: [ref(key()), theirs],
          story: { audio: ref(key()) },
          shots: { back: 'slate-file://storage:public/f_x/not-a-uuid/x.jpg' },
        },
        schema,
        FORM,
      ),
    ).toEqual(['docs', 'shots']);
    expect(foreignRefQuestions({ docs: ['https://x.example/a.png'] }, schema, FORM)).toEqual([]);
  });
});

describe('submit: files are claimed with the response', () => {
  it('uploads minted for the question are claimed by the stored response', async () => {
    const d = upload('docs');
    const v = upload('story');
    const f = upload('shots');
    const res = await submit({
      docs: [ref(d)],
      story: { audio: ref(v), sec: '3' },
      shots: { front: ref(f) },
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    for (const k of [d, v, f]) {
      expect(db.state.uploads.get(k)).toMatchObject({ state: 'claimed', submission_id: id });
    }
    const insert = db.state.log.find((q) => q.sql.includes('insert_public_submission'))!;
    expect(insert.params).toHaveLength(6);
    expect(JSON.parse(insert.params[4] as string)).toEqual([
      { key: d, question: 'docs' },
      { key: v, question: 'story' },
      { key: f, question: 'shots' },
    ]);
  });

  it('a file minted for another question is a 400 naming the question (JSON for a new page)', async () => {
    const d = upload('docs');
    const res = await submit({ more: [ref(d)] }, crypto.randomUUID());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: FILES_COPY, reason: 'files', questions: ['more'] });
    expect(db.state.submissions).toHaveLength(0);
    expect(db.state.uploads.get(d)?.state).toBe('pending');
  });

  it('an older page (no submitId) gets the same refusal as plain text', async () => {
    const d = upload('docs');
    const res = await submit({ more: [ref(d)] });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(FILES_COPY);
  });

  it('a file another response already claimed, or one past 24 h, is refused', async () => {
    const taken = upload('docs', { state: 'claimed', submission_id: 's_someone' });
    expect((await submit({ docs: [ref(taken)] })).status).toBe(400);
    db.state.now = Date.parse('2026-10-01T12:00:00Z');
    const old = upload('docs', { created_at: db.state.now - 25 * 3600 * 1000 });
    expect((await submit({ docs: [ref(old)] })).status).toBe(400);
    expect(db.state.submissions).toHaveLength(0);
  });

  it('an upload past its 2 h counting window is claimed only if the owner has room for it again', async () => {
    db.state.now = Date.parse('2026-10-01T12:00:00Z');
    const slow = upload('docs', {
      bytes: 300 * 1024 * 1024,
      created_at: db.state.now - 3 * 3600 * 1000,
    });
    // Someone filled the quota meanwhile (a claimed gigabyte minus 100 MiB).
    const filler = upload('more', {
      bytes: 1024 ** 3 - 100 * 1024 * 1024,
      state: 'claimed',
      submission_id: 's_filler',
    });
    const full = await submit({ docs: [ref(slow)] }, crypto.randomUUID());
    expect(full.status).toBe(400);
    expect(((await full.json()) as { questions: string[] }).questions).toEqual(['docs']);
    expect(db.state.uploads.get(slow)?.state).toBe('pending');
    // With room again, the slow fill goes through and its file counts from now on.
    db.state.uploads.get(filler)!.bytes = 100;
    expect((await submit({ docs: [ref(slow)] }, crypto.randomUUID())).status).toBe(200);
    expect(db.state.uploads.get(slow)?.state).toBe('claimed');
  });

  it('one upload named by two questions is refused', async () => {
    const d = upload(null);
    const res = await submit({ docs: [ref(d)], more: [ref(d)] }, crypto.randomUUID());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { questions: string[] }).questions.sort()).toEqual([
      'docs',
      'more',
    ]);
  });

  it('an old page’s upload (no question on its row) fits any file question', async () => {
    const legacy = upload(null, { legacy: true });
    expect((await submit({ more: [ref(legacy)] })).status).toBe(200);
    expect(db.state.uploads.get(legacy)?.state).toBe('claimed');
  });

  it('during the grace, an old page’s file with no row is taken under this form’s prefix only', async () => {
    const rowless = key();
    const res = await submit({ docs: [ref(rowless)] });
    expect(res.status).toBe(200);
    expect(db.state.uploads.get(rowless)).toMatchObject({
      state: 'claimed',
      bytes: 0,
      legacy: true,
      owner_id: OWNER,
    });
    db.state.storage.legacyOpen = false;
    expect((await submit({ docs: [ref(key())] })).status).toBe(400);
  });

  it('a retry with the same submitId returns the first response: one row, files claimed once', async () => {
    const d = upload('docs');
    const submitId = crypto.randomUUID();
    const first = await submit({ name: 'Ada', docs: [ref(d)] }, submitId);
    const firstId = ((await first.json()) as { id: string }).id;
    const again = await submit({ name: 'Ada', docs: [ref(d)] }, submitId);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(firstId);
    expect(db.state.submissions).toHaveLength(1);
    expect(db.state.uploads.get(d)).toMatchObject({ state: 'claimed', submission_id: firstId });
    // A new fill (a new submitId) can't reuse that file.
    expect((await submit({ docs: [ref(d)] }, crypto.randomUUID())).status).toBe(400);
  });

  it('a malformed submitId is a 400 before any query', async () => {
    for (const bad of [42, 'abc', '', crypto.randomUUID().toUpperCase(), {}]) {
      expect((await submit({ name: 'x' }, bad)).status, String(bad)).toBe(400);
    }
    expect(db.state.log).toHaveLength(0);
  });

  it('answers without files still send an empty list, and a new page’s submitId', async () => {
    const submitId = crypto.randomUUID();
    expect((await submit({ name: 'Ada' }, submitId)).status).toBe(200);
    const insert = db.state.log.find((q) => q.sql.includes('insert_public_submission'))!;
    expect(insert.params[4]).toBe('[]');
    expect(insert.params[5]).toBe(submitId);
  });
});
