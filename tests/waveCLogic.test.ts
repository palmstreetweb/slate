/**
 * Wave C logic (ADR-065): pins, location and the service-area radius,
 * availability encoding, voice / photo helpers, validation, piping,
 * conditions and schema checks — and the server's byte-for-byte copies.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import { IN_AREA_VALUE, OUT_OF_AREA_VALUE, checkSchema } from '@/index.js';
import { validate } from '@/logic/validation.js';
import { formatAnswerFor } from '@/logic/piping.js';
import { evaluate } from '@/logic/conditional.js';
import { areaIndex, checksArea } from '@/logic/address.js';
import { visibleQuestions, resolveJumpTarget } from '@/logic/progress.js';
import {
  PINS_MAX,
  imageKey,
  parsePin,
  pinAnswerCore,
  pinLimit,
  pinText,
  pinsOf,
  formatPins,
} from '@/logic/pins.js';
import {
  distanceKm,
  formZipAreas,
  hasGeoArea,
  locationAnswerCore,
  locationStoredCore,
  roundCoord,
} from '@/logic/geo.js';
import { formatDistance, locationDistance } from '@/logic/geoText.js';
import {
  availabilityAnswerCore,
  availabilityGrid,
  availabilityHours,
  clockLabel,
  decodeAvailability,
  encodeAvailability,
  formatAvailability,
} from '@/logic/availability.js';
import {
  formatClock,
  formatPhotoCount,
  formatVoiceNote,
  photosTaken,
  voiceMaxBytes,
  voiceMaxSeconds,
} from '@/logic/media.js';
import * as serverUpload from '../neon/functions/storage-sign/uploadPolicy.js';
import * as media from '@/logic/media.js';

function sharedSection(path: string): string {
  const text = readFileSync(resolve(path), 'utf8');
  const start = text.indexOf('/* ---------- shared with the server (keep identical) ---------- */');
  const end = text.indexOf('/* ---------- engine-only helpers ---------- */');
  return (end === -1 ? text.slice(start) : text.slice(start, end)).trim();
}

describe('the submit Function copies the shared Wave C code byte for byte', () => {
  it.each(['geo', 'pins', 'availability'])('%s', (name) => {
    const engine = sharedSection(`src/logic/${name}.ts`);
    const server = sharedSection(`neon/functions/submit-response/${name}.ts`);
    expect(engine.length).toBeGreaterThan(1000);
    expect(server).toBe(engine);
  });

  it('storage-sign mirrors the voice and photo size caps', () => {
    for (const s of [5, 30, 60, 61, 120, 300]) {
      expect(serverUpload.voiceMaxBytes(s)).toBe(media.voiceMaxBytes(s));
    }
    expect(serverUpload.PHOTO_MAX_BYTES).toBe(media.PHOTO_MAX_BYTES);
  });
});

/* ---------- pins ---------- */

describe('pins', () => {
  const q = { type: 'image_pin', maxPins: 2, image: 'https://example.com/a.jpg' };

  it('parses only what the engine writes', () => {
    expect(parsePin('0.25,0.5')).toEqual([0.25, 0.5]);
    expect(parsePin('0,1')).toEqual([0, 1]);
    expect(parsePin('1.0000,0.0001')).toEqual([1, 0.0001]);
    for (const bad of [
      '1.1,0',
      '-0.1,0.2',
      '0.12345,0.1',
      '0.5',
      ' 0.5,0.5',
      '0.5, 0.5',
      '.5,.5',
      '1e-3,0',
    ]) {
      expect(parsePin(bad)).toBeNull();
    }
    expect(parsePin(5)).toBeNull();
  });

  it('writes pins rounded to 4 decimals and clamped to the photo', () => {
    expect(pinText(0.123456, 0.9)).toBe('0.1235,0.9');
    expect(pinText(-3, 7)).toBe('0,1');
    expect(parsePin(pinText(Math.random(), Math.random()))).not.toBeNull();
  });

  it('limits: 1–10, default 3', () => {
    expect(pinLimit({})).toBe(3);
    expect(pinLimit({ maxPins: 0 })).toBe(3);
    expect(pinLimit({ maxPins: 99 })).toBe(PINS_MAX);
    expect(pinLimit({ maxPins: 4.7 })).toBe(4);
  });

  it('the server shape keeps good pins under the limit, notes aligned, and the photo key', () => {
    const out = pinAnswerCore(q, {
      pins: ['0.1,0.1', 'junk', '0.2,0.2', '0.3,0.3'],
      notes: ['  leak here ', 'x', '', 'too many'],
      img: 'forged',
    });
    expect(out).toEqual({
      pins: ['0.1,0.1', '0.2,0.2'],
      notes: ['leak here', ''],
      img: imageKey(q.image),
    });
    expect(pinAnswerCore({ ...q, notes: false }, { pins: ['0.1,0.1'], notes: ['a'] })).toEqual({
      pins: ['0.1,0.1'],
      img: imageKey(q.image),
    });
    expect(pinAnswerCore(q, { pins: [] })).toBeUndefined();
    expect(pinAnswerCore(q, 'nope')).toBeUndefined();
    const long = pinAnswerCore({}, { pins: ['0.5,0.5'], notes: ['n'.repeat(500)] }) as {
      notes: string[];
    };
    expect(long.notes[0]).toHaveLength(140);
  });

  it('the photo key is stable, short, and differs per photo', () => {
    expect(imageKey('a')).toMatch(/^[0-9a-f]{8}$/);
    expect(imageKey('a')).toBe(imageKey('a'));
    expect(imageKey('a')).not.toBe(imageKey('b'));
    expect(imageKey(undefined)).toBe('');
  });

  it('reads and formats', () => {
    const a = { pins: ['0.1,0.2', '0.5,0.5'], notes: ['leak here', ''] };
    expect(pinsOf(a)).toEqual([
      { x: 0.1, y: 0.2, note: 'leak here' },
      { x: 0.5, y: 0.5, note: '' },
    ]);
    expect(formatPins(a)).toBe('2 spots: leak here');
    expect(formatPins({ pins: ['0,0'] })).toBe('1 spot');
    expect(formatPins(undefined)).toBe('');
  });
});

/* ---------- location ---------- */

describe('location and the service-area radius', () => {
  const sb = { lat: 34.4208, lng: -119.6982 }; // Santa Barbara
  const q = { type: 'location', center: sb, radius: 10, radiusUnit: 'mi' };

  it('rounds to 3 decimals, never finer, and refuses nonsense', () => {
    expect(roundCoord(34.420845, 90)).toBe('34.421');
    expect(roundCoord(-0.0004, 90)).toBe('0.000');
    expect(roundCoord('34.5', 90)).toBe('34.500');
    expect(roundCoord(91, 90)).toBeNull();
    expect(roundCoord('34.5; drop table', 90)).toBeNull();
    expect(roundCoord(Number.NaN, 180)).toBeNull();
  });

  it('measures great-circle distance', () => {
    // Santa Barbara → Los Angeles is about 137 km.
    expect(distanceKm(sb.lat, sb.lng, 34.0522, -118.2437)).toBeGreaterThan(130);
    expect(distanceKm(sb.lat, sb.lng, 34.0522, -118.2437)).toBeLessThan(145);
    expect(distanceKm(1, 1, 1, 1)).toBe(0);
  });

  it('recomputes in / out from the question, whatever the page claims', () => {
    expect(locationAnswerCore(q, { lat: 34.44, lng: -119.81, area: 'out' }, [])).toEqual({
      lat: '34.440',
      lng: '-119.810',
      area: 'in',
    });
    expect(locationAnswerCore(q, { lat: 34.0522, lng: -118.2437, area: 'in' }, [])).toEqual({
      lat: '34.052',
      lng: '-118.244',
      area: 'out',
    });
    // In km: 5 km doesn’t reach Goleta, about 10 km from the center.
    const km = { ...q, radius: 5, radiusUnit: 'km' };
    expect(locationAnswerCore(km, { lat: 34.44, lng: -119.81 }, [])?.area).toBe('out');
    // No center or no radius: coordinates only.
    expect(locationAnswerCore({ type: 'location' }, { lat: 1, lng: 2 }, [])).toEqual({
      lat: '1.000',
      lng: '2.000',
    });
  });

  it('checks a typed ZIP against the form’s address areas, and keeps a typed place', () => {
    expect(locationAnswerCore(q, { zip: '93101-1234' }, ['931'])).toEqual({
      zip: '931011234',
      area: 'in',
    });
    expect(locationAnswerCore(q, { zip: '90210' }, ['931'])).toEqual({ zip: '90210', area: 'out' });
    expect(locationAnswerCore(q, { zip: '93101' }, [])).toEqual({ zip: '93101' });
    expect(locationAnswerCore(q, { zip: '<b>' }, ['931'])).toBeUndefined();
    expect(locationAnswerCore(q, { typed: '  Goleta ' }, [])).toEqual({ typed: 'Goleta' });
    expect(locationAnswerCore(q, { typed: 'x'.repeat(300) }, [])?.typed).toHaveLength(100);
    expect(locationAnswerCore(q, {}, [])).toBeUndefined();
    expect(locationAnswerCore(q, [1, 2], [])).toBeUndefined();
  });

  it('reads ZIP areas from the form’s address questions', () => {
    expect(
      formZipAreas([
        { type: 'address', serviceArea: ['931*', ' 93003 ', 'bad!'] },
        { type: 'short_text' },
        { type: 'address', serviceArea: ['931'] },
      ]),
    ).toEqual(['931', '93003']);
    expect(formZipAreas('nope')).toEqual([]);
  });

  it('distance and its wording', () => {
    expect(locationDistance(q, { lat: '34.421', lng: '-119.698' })).toBeLessThan(0.1);
    expect(locationDistance({ type: 'location' }, { lat: '1', lng: '1' })).toBeNull();
    expect(formatDistance(4.26, 'mi')).toBe('4.3 mi');
    expect(formatDistance(31.4, 'km')).toBe('31 km');
    expect(hasGeoArea(q)).toBe(true);
    expect(hasGeoArea({ center: sb })).toBe(false);
  });
});

describe('what a location stores (ADR-068)', () => {
  const sb = { lat: 34.4208, lng: -119.6982 };
  const q = { type: 'location', center: sb, radius: 10, radiusUnit: 'mi' };
  const kept = { ...q, keepLocation: true };

  it('by default only the verdict and how it was given: no coordinates, ZIP or place', () => {
    expect(locationStoredCore(q, { lat: 34.44, lng: -119.81 }, [])).toEqual({
      area: 'in',
      via: 'gps',
    });
    expect(locationStoredCore(q, { zip: '93101' }, ['931'])).toEqual({ area: 'in', via: 'zip' });
    expect(locationStoredCore(q, { zip: '90210' }, ['931'])).toEqual({ area: 'out', via: 'zip' });
    expect(locationStoredCore(q, { typed: 'Goleta' }, ['931'])).toEqual({ typed: 'Goleta' });
    // Nothing to check against: that they answered, and how.
    expect(locationStoredCore({ type: 'location' }, { lat: 1, lng: 2 }, [])).toEqual({
      via: 'gps',
    });
    expect(locationStoredCore(q, { zip: '93101' }, [])).toEqual({ via: 'zip' });
  });

  it('a forged verdict is still the server’s own, and a verdict alone is nothing', () => {
    // Los Angeles claiming "in".
    expect(locationStoredCore(q, { lat: 34.0522, lng: -118.2437, area: 'in' }, [])).toEqual({
      area: 'out',
      via: 'gps',
    });
    expect(locationStoredCore(q, { area: 'in', via: 'gps' }, [])).toBeUndefined();
    expect(locationStoredCore(q, { area: 'in' }, [])).toBeUndefined();
    expect(locationStoredCore(q, 'in', [])).toBeUndefined();
  });

  it('keepLocation: true stores the answer as ADR-065 did; anything else is verdict-only', () => {
    expect(locationStoredCore(kept, { lat: 34.44123, lng: -119.81234, area: 'out' }, [])).toEqual({
      lat: '34.441',
      lng: '-119.812',
      area: 'in',
    });
    expect(locationStoredCore(kept, { zip: '93101' }, ['931'])).toEqual({
      zip: '93101',
      area: 'in',
    });
    expect(locationStoredCore(kept, { typed: ' Goleta ' }, [])).toEqual({ typed: 'Goleta' });
    for (const keepLocation of ['true', 1, false, null, {}]) {
      expect(locationStoredCore({ ...q, keepLocation }, { lat: 34.44, lng: -119.81 }, [])).toEqual({
        area: 'in',
        via: 'gps',
      });
    }
  });

  it('never stores a digit of the position by default', () => {
    for (let i = 0; i < 200; i++) {
      const lat = -80 + Math.random() * 160;
      const lng = -170 + Math.random() * 340;
      const stored = JSON.stringify(locationStoredCore(q, { lat, lng }, []));
      expect(stored).not.toMatch(/\d/);
      expect(Object.keys(JSON.parse(stored) as object).sort()).toEqual(['area', 'via']);
    }
  });
});

/* ---------- availability ---------- */

describe('availability grid', () => {
  const q = {
    type: 'availability',
    days: ['mon', 'wed'],
    startTime: '08:00',
    endTime: '12:00',
    slotMinutes: 30,
  };

  it('reads the grid, falling back to Mon–Fri, 8–6, hourly', () => {
    expect(availabilityGrid(q)).toEqual({ days: ['mon', 'wed'], start: 480, slot: 30, count: 8 });
    expect(availabilityGrid({})).toEqual({
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      start: 480,
      slot: 60,
      count: 10,
    });
    expect(availabilityGrid({ startTime: '18:00', endTime: '08:00' }).count).toBe(10);
    expect(availabilityGrid({ days: ['xyz', 'sun', 'sun'], slotMinutes: 45 })).toMatchObject({
      days: ['sun'],
      slot: 60,
    });
    expect(availabilityGrid({ startTime: '00:00', endTime: '24:00', slotMinutes: 15 }).count).toBe(
      96,
    );
  });

  it('decodes, merges and re-encodes canonically', () => {
    const g = availabilityGrid(q);
    const picked = decodeAvailability(g, {
      mon: '08:00-09:00,09:00-10:30',
      wed: '11:30-12:00',
      fri: '08:00-09:00',
    });
    expect([...picked.get('mon')!]).toEqual([0, 1, 2, 3, 4]);
    expect(encodeAvailability(g, picked)).toEqual({ mon: '08:00-10:30', wed: '11:30-12:00' });
  });

  it('drops times that aren’t slot edges inside the grid', () => {
    expect(
      availabilityAnswerCore(q, {
        mon: '08:15-09:00,07:00-08:00,11:00-12:30,10:00-09:00,junk',
        wed: '09:00-10:00',
        tue: '08:00-09:00',
      }),
    ).toEqual({ wed: '09:00-10:00' });
    expect(availabilityAnswerCore(q, { mon: 'x'.repeat(5000) })).toBeUndefined();
    expect(availabilityAnswerCore(q, 'mon')).toBeUndefined();
  });

  it('formats for people', () => {
    expect(clockLabel(9 * 60)).toBe('9 AM');
    expect(clockLabel(12 * 60 + 30)).toBe('12:30 PM');
    expect(clockLabel(0)).toBe('12 AM');
    const answer = { mon: '08:00-10:30', wed: '11:30-12:00' };
    expect(formatAvailability(q, answer)).toBe('Mon 8–10:30 AM; Wed 11:30 AM–12 PM');
    expect(availabilityHours(q, answer)).toBe(3);
  });
});

/* ---------- voice and photos ---------- */

describe('voice notes and photo checklists', () => {
  it('voice length and size caps', () => {
    expect(voiceMaxSeconds({})).toBe(60);
    expect(voiceMaxSeconds({ maxSeconds: 1 })).toBe(5);
    expect(voiceMaxSeconds({ maxSeconds: 999 })).toBe(300);
    expect(voiceMaxBytes(5)).toBe(1024 * 1024);
    expect(voiceMaxBytes(60)).toBe(60 * 40_000 + 65_536);
  });

  it('formats', () => {
    expect(formatClock(42)).toBe('0:42');
    expect(formatClock(65)).toBe('1:05');
    expect(formatVoiceNote({ audio: 'slate-file://x', sec: '42' })).toBe('Voice note (0:42)');
    expect(formatVoiceNote({ typed: ' It leaks ' })).toBe('It leaks');
    expect(formatVoiceNote({})).toBe('');
    const pq = {
      items: [
        { label: 'Front', value: 'front' },
        { label: 'Roof', value: 'roof' },
      ],
    };
    expect(photosTaken(pq, { front: 'ref', roof: '', junk: 'x' })).toEqual(['front']);
    expect(formatPhotoCount(pq, { front: 'ref' })).toBe('1 of 2 photos');
  });
});

/* ---------- validation, piping, conditions, schema checks ---------- */

describe('Wave C validation', () => {
  it('pins', () => {
    const q: Question = { id: 'p', type: 'image_pin', title: 'T', required: true, maxPins: 1 };
    expect(validate(q, undefined)?.code).toBe('required');
    expect(validate(q, { pins: [] })?.code).toBe('required');
    expect(validate(q, { pins: ['0.5,0.5'] })).toBeNull();
    expect(validate(q, { pins: ['0.5,0.5', '0.1,0.1'] })?.code).toBe('max_pins');
    expect(validate(q, { pins: ['2,2'] })?.code).toBe('shape');
    expect(validate({ ...q, required: false } as Question, undefined)).toBeNull();
  });

  it('voice notes', () => {
    const q: Question = { id: 'v', type: 'voice_note', title: 'T', required: true };
    expect(validate(q, undefined)?.message).toMatch(/record or type/i);
    expect(validate({ ...q, allowTyped: false } as Question, undefined)?.message).toMatch(
      /record a voice/i,
    );
    expect(validate(q, { audio: 'slate-file://x', sec: '12' })).toBeNull();
    expect(validate(q, { audio: 'slate-file://x', sec: '9999' })?.code).toBe('shape');
    expect(validate(q, { typed: 'The gutter leaks' })).toBeNull();
    expect(validate({ ...q, allowTyped: false } as Question, { typed: 'x' })?.code).toBe('shape');
    expect(validate(q, { typed: 'x'.repeat(1001) })?.code).toBe('too_long');
  });

  it('location', () => {
    const q: Question = { id: 'l', type: 'location', title: 'T', required: true };
    expect(validate(q, undefined)?.code).toBe('required');
    expect(validate(q, { lat: '34.420', lng: '-119.698' })).toBeNull();
    expect(validate(q, { zip: '93101' })).toBeNull();
    expect(validate(q, { typed: 'Goleta' })).toBeNull();
    expect(validate(q, { lat: 'x', lng: 'y' })?.code).toBe('shape');
  });

  it('photo checklist: every shot by default', () => {
    const q: Question = {
      id: 'c',
      type: 'photo_checklist',
      title: 'T',
      items: [
        { label: 'Front', value: 'front' },
        { label: 'Roof', value: 'roof' },
      ],
    };
    expect(validate(q, undefined)?.message).toBe('2 more photos to go');
    expect(validate(q, { front: 'ref' })?.message).toBe('One more photo to go');
    expect(validate(q, { front: 'ref', roof: 'ref2' })).toBeNull();
    expect(validate({ ...q, required: false } as Question, { front: 'ref' })).toBeNull();
  });

  it('availability', () => {
    const q: Question = { id: 'a', type: 'availability', title: 'T', required: true };
    expect(validate(q, undefined)?.code).toBe('required');
    expect(validate(q, { mon: '09:00-10:00' })).toBeNull();
    // Shape only in the engine; the grid itself is enforced by the server's re-encode.
    expect(validate(q, { mon: 'mornings' })?.code).toBe('shape');
    expect(validate(q, { mon: '' })?.code).toBe('required');
    expect(validate({ ...q, required: false } as Question, {})).toBeNull();
  });
});

describe('Wave C piping', () => {
  it('reads answers in words, never coordinates', () => {
    const loc: Question = { id: 'l', type: 'location', title: 'T' };
    expect(formatAnswerFor(loc, { lat: '1.000', lng: '2.000', area: 'in' })).toBe(
      'inside the service area',
    );
    expect(formatAnswerFor(loc, { lat: '1.000', lng: '2.000', area: 'out' })).toBe(
      'outside the service area',
    );
    expect(formatAnswerFor(loc, { lat: '1.000', lng: '2.000' })).toBe('');
    expect(formatAnswerFor(loc, { zip: '93101' })).toBe('93101');
    // A stored verdict-only answer (ADR-068) reads the same way.
    expect(formatAnswerFor(loc, { area: 'out', via: 'zip' })).toBe('outside the service area');
    expect(formatAnswerFor(loc, { via: 'typed' })).toBe('');
    const week: Question = { id: 'w', type: 'availability', title: 'T', days: ['tue'] };
    // On a 12-hour clock (ADR-069); a day that runs to midnight ends at 12:00 AM.
    expect(formatAnswerFor(week, { tue: '09:00-11:00,14:00-15:00' })).toBe(
      'Tue 9:00 AM–11:00 AM, 2:00 PM–3:00 PM',
    );
    expect(formatAnswerFor(week, { tue: '22:00-24:00' })).toBe('Tue 10:00 PM–12:00 AM');
    const pin: Question = { id: 'p', type: 'image_pin', title: 'T' };
    expect(formatAnswerFor(pin, { pins: ['0.1,0.1'], notes: ['here'] })).toBe('1 spot: here');
  });
});

describe('location routes like an address (IN_AREA_VALUE / OUT_OF_AREA_VALUE)', () => {
  const questions: Question[] = [
    {
      id: 'where',
      type: 'location',
      title: 'Where?',
      center: { lat: 34.4208, lng: -119.6982 },
      radius: 10,
      logic: [{ if: { field: 'where', op: 'equals', value: OUT_OF_AREA_VALUE }, goTo: 'sorry' }],
    },
    { id: 'more', type: 'short_text', title: 'More' },
    {
      id: 'sorry',
      type: 'thanks',
      title: 'Out of area',
      visibleIf: { field: 'where', op: 'equals', value: OUT_OF_AREA_VALUE },
    },
    { id: 'done', type: 'thanks', title: 'Thanks' },
  ];
  const areas = areaIndex(questions);
  const out = { field: 'where', op: 'equals', value: OUT_OF_AREA_VALUE } as const;
  const inside = { field: 'where', op: 'equals', value: IN_AREA_VALUE } as const;

  it('recomputes from the answer, not its stored verdict', () => {
    const la = { lat: '34.052', lng: '-118.244', area: 'in' };
    expect(evaluate(out, { where: la }, undefined, areas)).toBe(true);
    expect(evaluate(inside, { where: la }, undefined, areas)).toBe(false);
    const goleta = { lat: '34.441', lng: '-119.812' };
    expect(evaluate(inside, { where: goleta }, undefined, areas)).toBe(true);
    expect(evaluate(out, {}, undefined, areas)).toBe(false);
    expect(evaluate(out, { where: { typed: 'Goleta' } }, undefined, areas)).toBe(false);
  });

  it('jumps to the out-of-area ending', () => {
    const answers = { where: { lat: '34.052', lng: '-118.244' } };
    const visible = visibleQuestions(questions, answers);
    expect(visible.map((q) => q.id)).toContain('sorry');
    expect(resolveJumpTarget(questions[0]!, visible, answers, undefined, areas)).toBe(
      visible.findIndex((q) => q.id === 'sorry'),
    );
  });

  it('a ZIP typed instead routes by the form’s address ZIP list', () => {
    const withAddress: Question[] = [
      { id: 'where', type: 'location', title: 'Where?' },
      { id: 'addr', type: 'address', title: 'Address', serviceArea: ['931'] },
    ];
    const idx = areaIndex(withAddress);
    expect(checksArea(withAddress[0]!, withAddress)).toBe(true);
    expect(evaluate(out, { where: { zip: '90210' } }, undefined, idx)).toBe(true);
    expect(evaluate(inside, { where: { zip: '93105' } }, undefined, idx)).toBe(true);
  });
});

describe('Wave C schema checks', () => {
  const kinds = (qs: Question[]) => checkSchema(qs).map((i) => i.kind);

  it('flags a pin question without a usable photo', () => {
    expect(kinds([{ id: 'p', type: 'image_pin', title: 'T' }])).toContain('no_image');
    expect(
      kinds([{ id: 'p', type: 'image_pin', title: 'T', image: 'http://x.com/a.jpg' }]),
    ).toContain('no_image');
    expect(
      kinds([{ id: 'p', type: 'image_pin', title: 'T', image: 'https://x.com/a.jpg' }]),
    ).toEqual([]);
    expect(
      kinds([{ id: 'p', type: 'image_pin', title: 'T', image: 'data:image/jpeg;base64,AAAA' }]),
    ).toEqual([]);
  });

  it('flags an empty checklist, a bad grid, a half-set area and single-select swipe', () => {
    expect(kinds([{ id: 'c', type: 'photo_checklist', title: 'T', items: [] }])).toContain(
      'no_items',
    );
    expect(kinds([{ id: 'a', type: 'availability', title: 'T', slotMinutes: 45 }])).toContain(
      'bad_grid',
    );
    expect(
      kinds([{ id: 'a', type: 'availability', title: 'T', startTime: '17:00', endTime: '09:00' }]),
    ).toContain('bad_grid');
    expect(kinds([{ id: 'a', type: 'availability', title: 'T' }])).toEqual([]);
    expect(kinds([{ id: 'l', type: 'location', title: 'T', radius: 10 }])).toContain(
      'bad_service_area',
    );
    expect(
      kinds([{ id: 'l', type: 'location', title: 'T', center: { lat: 34.4, lng: -119.7 } }]),
    ).toContain('bad_service_area');
    expect(
      kinds([{ id: 's', type: 'picture_choice', title: 'T', options: [], display: 'swipe' }]),
    ).toContain('swipe_single');
  });

  it('an area condition on a location needs a radius (or ZIP lists)', () => {
    const qs: Question[] = [
      { id: 'l', type: 'location', title: 'T' },
      {
        id: 'x',
        type: 'thanks',
        title: 'Out',
        visibleIf: { field: 'l', op: 'equals', value: OUT_OF_AREA_VALUE },
      },
    ];
    expect(kinds(qs)).toContain('area_off');
    const fixed = [{ ...qs[0]!, center: { lat: 1, lng: 1 }, radius: 5 } as Question, qs[1]!];
    expect(kinds(fixed)).not.toContain('area_off');
  });
});
