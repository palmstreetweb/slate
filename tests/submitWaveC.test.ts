/** @vitest-environment node */
/**
 * The submit Function and Wave C (ADR-065): per-type clamps for pins,
 * locations, availability, voice notes and photo checklists, and the real
 * Hono app storing them — a location's in / out of the area is always the
 * server's own verdict, from the published center and radius, and by default
 * it is all that is stored of a location (ADR-068).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampForQuestion,
  VOICE_TYPED_MAX,
} from '../neon/functions/submit-response/answerShape.js';
import { imageKey } from '@/logic/pins.js';
import * as media from '@/logic/media.js';
import { addUpload, resetFnDb, type newFnDbState } from './_fnDb.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const FORM = 'f_wavecform001';
const OTHER = 'f_otherform001';
const IP = '203.0.113.65';
const UUID = '0b8e4f5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const ref = (form = FORM, name = 'front.jpg') =>
  `slate-file://storage:public/${form}/${UUID}/${name}`;
const PHOTO = 'https://example.com/roof.jpg';

const schema = {
  brand: { name: 'Roofing' },
  questions: [
    { id: 'leak', type: 'image_pin', title: 'Where?', image: PHOTO, maxPins: 2 },
    {
      id: 'where',
      type: 'location',
      title: 'Where’s the job?',
      center: { lat: 34.4208, lng: -119.6982 },
      radius: 25,
      radiusUnit: 'mi',
    },
    { id: 'zipOnly', type: 'location', title: 'ZIP?' },
    // The owner kept the approximate location (ADR-068): stored as ADR-065 did.
    {
      id: 'kept',
      type: 'location',
      title: 'Where exactly?',
      center: { lat: 34.4208, lng: -119.6982 },
      radius: 25,
      keepLocation: true,
    },
    { id: 'keptZip', type: 'location', title: 'ZIP?', keepLocation: true },
    { id: 'addr', type: 'address', title: 'Address', serviceArea: ['931'] },
    { id: 'when', type: 'availability', title: 'When?', days: ['mon', 'tue'], slotMinutes: 30 },
    { id: 'story', type: 'voice_note', title: 'Tell us', maxSeconds: 30 },
    { id: 'quiet', type: 'voice_note', title: 'Audio only', allowTyped: false },
    {
      id: 'shots',
      type: 'photo_checklist',
      title: 'Photos',
      items: [
        { label: 'Front', value: 'front' },
        { label: 'Roof', value: 'roof' },
      ],
    },
    {
      id: 'likes',
      type: 'picture_choice',
      title: 'Like?',
      display: 'swipe',
      multiple: true,
      options: [{ label: 'A', value: 'a', src: PHOTO }],
    },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ],
};

let app: { request: (path: string, init: RequestInit) => Response | Promise<Response> };
const savedDb = process.env.DATABASE_URL;

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://test@localhost/test';
  app = (await import('../neon/functions/submit-response/index.js')).default;
});

afterAll(() => {
  if (savedDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDb;
});

beforeEach(() => {
  resetFnDb(db.state);
  db.state.forms.set(FORM, {
    id: FORM,
    name: 'Roof quote',
    slug: '12345679',
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner_c',
    fill_password_hash: null,
    published_schema: schema,
  });
});

const submit = (answers: Record<string, unknown>) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
    body: JSON.stringify({
      formId: FORM,
      answers,
      meta: {
        startedAt: '2026-09-30T10:00:00.000Z',
        completedAt: '2026-09-30T10:02:00.000Z',
        durationMs: 120000,
        questionsVisited: [],
        hiddenFields: {},
        score: 0,
      },
    }),
  });

const stored = () => db.state.submissions[0] as { answers: Record<string, unknown> };

describe('clampForQuestion: Wave C shapes', () => {
  const byId = Object.fromEntries(schema.questions.map((q) => [q.id, q])) as Record<
    string,
    Record<string, unknown>
  >;

  it('pins: in range, under the limit, notes aligned, the published photo’s key', () => {
    expect(
      clampForQuestion(byId.leak!, {
        pins: ['0.5,0.5', '9,9', '0.25,0.75', '0.1,0.1'],
        notes: ['leak', 'x', ' seal ', 'extra'],
        img: 'forged',
      }),
    ).toEqual({ pins: ['0.5,0.5', '0.25,0.75'], notes: ['leak', 'seal'], img: imageKey(PHOTO) });
    expect(clampForQuestion(byId.leak!, { pins: ['<script>'] })).toBeUndefined();
    expect(clampForQuestion(byId.leak!, '0.5,0.5')).toBeUndefined();
  });

  it('location: in / out recomputed from the published radius, then only the verdict kept', () => {
    expect(
      clampForQuestion(byId.where!, { lat: 34.0522, lng: -118.2437, area: 'in' }, { zipAreas: [] }),
    ).toEqual({ area: 'out', via: 'gps' });
    expect(
      clampForQuestion(byId.where!, { lat: '34.44123456', lng: '-119.81', area: 'out' }),
    ).toEqual({ area: 'in', via: 'gps' });
    expect(clampForQuestion(byId.zipOnly!, { zip: '93105' }, { zipAreas: ['931'] })).toEqual({
      area: 'in',
      via: 'zip',
    });
    expect(clampForQuestion(byId.zipOnly!, { typed: 'Goleta', area: 'in' })).toEqual({
      typed: 'Goleta',
    });
    expect(clampForQuestion(byId.where!, { lat: 'north', lng: 1 })).toBeUndefined();
    // A verdict with nothing to check it against is not an answer.
    expect(clampForQuestion(byId.where!, { area: 'in', via: 'gps' })).toBeUndefined();
  });

  it('location with keepLocation: rounded coordinates, the ZIP or the place, as before', () => {
    expect(
      clampForQuestion(byId.kept!, { lat: 34.0522, lng: -118.2437, area: 'in' }, { zipAreas: [] }),
    ).toEqual({ lat: '34.052', lng: '-118.244', area: 'out' });
    expect(
      clampForQuestion(byId.kept!, { lat: '34.44123456', lng: '-119.81', area: 'out' }),
    ).toEqual({ lat: '34.441', lng: '-119.810', area: 'in' });
    expect(clampForQuestion(byId.keptZip!, { zip: '93105' }, { zipAreas: ['931'] })).toEqual({
      zip: '93105',
      area: 'in',
    });
    expect(clampForQuestion(byId.keptZip!, { typed: 'Goleta', area: 'in' })).toEqual({
      typed: 'Goleta',
    });
    // Only a real `true` keeps it.
    expect(
      clampForQuestion({ ...byId.kept!, keepLocation: 'yes' }, { lat: 34.44, lng: -119.81 }),
    ).toEqual({ area: 'in', via: 'gps' });
  });

  it('availability: re-encoded on the published grid', () => {
    expect(
      clampForQuestion(byId.when!, {
        mon: '09:00-09:30,09:30-10:00,09:15-10:00',
        tue: '23:00-23:30',
        sun: '09:00-10:00',
      }),
    ).toEqual({ mon: '09:00-10:00' });
    expect(clampForQuestion(byId.when!, { mon: 'all day' })).toBeUndefined();
  });

  it('voice: this form’s own recording and a capped length, or typed text when allowed', () => {
    const ctx = { formId: FORM };
    expect(
      clampForQuestion(byId.story!, { audio: ref(FORM, 'voice.webm'), sec: '42' }, ctx),
    ).toEqual({
      audio: ref(FORM, 'voice.webm'),
      sec: '30',
    });
    expect(clampForQuestion(byId.story!, { audio: ref(OTHER, 'voice.webm') }, ctx)).toBeUndefined();
    expect(
      clampForQuestion(byId.story!, { audio: 'https://evil.example/a.mp3' }, ctx),
    ).toBeUndefined();
    expect(clampForQuestion(byId.story!, { audio: ref(FORM, 'v.m4a'), sec: 'x' }, ctx)).toEqual({
      audio: ref(FORM, 'v.m4a'),
    });
    expect(
      (clampForQuestion(byId.story!, { typed: 'y'.repeat(5000) }, ctx) as { typed: string }).typed,
    ).toHaveLength(VOICE_TYPED_MAX);
    // Typing off still keeps typed text: the page offers it only when the
    // microphone is blocked or missing, so a required voice note never traps
    // anyone (MEDIA-17).
    expect(clampForQuestion(byId.quiet!, { typed: ' hi ' }, ctx)).toEqual({ typed: 'hi' });
    expect(VOICE_TYPED_MAX).toBe(media.VOICE_TYPED_MAX);
  });

  it('photo checklist: published items only, each this form’s own ref', () => {
    const ctx = { formId: FORM };
    expect(
      clampForQuestion(
        byId.shots!,
        { front: ref(), roof: ref(OTHER), panel: ref(FORM, 'p.jpg'), toString: ref() },
        ctx,
      ),
    ).toEqual({ front: ref() });
    expect(clampForQuestion(byId.shots!, { front: ref() })).toBeUndefined();
  });
});

describe('submit: Wave C answers as stored', () => {
  it('stores every Wave C answer in its server shape; a forged area is replaced', async () => {
    // ADR-067: the files are uploads storagesign recorded for these questions.
    addUpload(db.state, { key: ref(FORM, 'voice.m4a').slice(21), question_id: 'story' });
    addUpload(db.state, { key: ref().slice(21), question_id: 'shots' });
    const res = await submit({
      leak: { pins: ['0.5,0.5'], notes: ['leak'] },
      where: { lat: 34.0522, lng: -118.2437, area: 'in' },
      zipOnly: { zip: '90210', area: 'in' },
      kept: { lat: 34.0522, lng: -118.2437, area: 'in' },
      keptZip: { zip: '93105-1234' },
      when: { mon: '09:00-10:00' },
      story: { audio: ref(FORM, 'voice.m4a'), sec: '12' },
      // An item the question doesn't publish is dropped, not refused.
      shots: { front: ref(), shed: ref(FORM, 'shed.jpg') },
      likes: [],
    });
    expect(res.status).toBe(200);
    expect(stored().answers).toEqual({
      leak: { pins: ['0.5,0.5'], notes: ['leak'], img: imageKey(PHOTO) },
      // Only the verdict (ADR-068): no coordinates, no distance, no ZIP.
      where: { area: 'out', via: 'gps' },
      // Checked against the published address's ZIP list, then dropped.
      zipOnly: { area: 'out', via: 'zip' },
      // The owner kept the approximate location.
      kept: { lat: '34.052', lng: '-118.244', area: 'out' },
      keptZip: { zip: '931051234', area: 'in' },
      when: { mon: '09:00-10:00' },
      story: { audio: ref(FORM, 'voice.m4a'), sec: '12' },
      shots: { front: ref() },
      likes: [],
    });
  });

  it('by default nothing of the position reaches the stored row (ADR-068)', async () => {
    await submit({
      where: { lat: 34.052235, lng: -118.243683, area: 'in' },
      zipOnly: { zip: '90210' },
    });
    const row = JSON.stringify(db.state.submissions[0]);
    expect(row).not.toMatch(/34\.05|118\.24|90210|"lat":|"lng":|"zip":/);
    expect(stored().answers.where).toEqual({ area: 'out', via: 'gps' });
    // A verdict sent without the position it came from is dropped, never trusted.
    await submit({ where: { area: 'in', via: 'gps' } });
    const wheres = db.state.submissions.map((s) => (s as { answers: { where?: unknown } }).answers);
    expect(wheres.filter((a) => a.where !== undefined)).toHaveLength(1);
  });

  it('drops a Wave C answer that is nothing but junk, keeping the rest', async () => {
    await submit({ leak: { pins: ['9,9'] }, when: { mon: 'soon' }, story: { audio: 'nope' } });
    expect(stored().answers).toEqual({});
    await submit({ where: { typed: 'Goleta' } });
    expect(
      db.state.submissions.some((s) => (s as { answers: { where?: unknown } }).answers.where),
    ).toBe(true);
  });

  // ADR-067: a voice note or checklist naming another form's file used to be dropped (ADR-058);
  // the page never sends one, so it is now refused and nothing is stored.
  it('another form’s file in a voice note or a checklist is a 400', async () => {
    expect((await submit({ story: { audio: ref(OTHER) } })).status).toBe(400);
    expect((await submit({ shots: { front: ref(OTHER) } })).status).toBe(400);
    expect(db.state.submissions).toHaveLength(0);
  });

  it('a file nobody signed (no row, grace over) is a 400 naming its question', async () => {
    db.state.storage.legacyOpen = false;
    const res = await submit({ story: { audio: ref(FORM, 'voice.m4a') } });
    expect(res.status).toBe(400);
    expect(db.state.submissions).toHaveLength(0);
  });
});
