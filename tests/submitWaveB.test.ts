/** @vitest-environment node */
/**
 * The submit Function and Wave B (ADR-064): per-type clamps for the contact
 * block, the address and the signature, and the instant estimate stored with
 * the response — recomputed from the published schema, never taken from the
 * request.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADDRESS_PART_MAX,
  CONTACT_PART_MAX,
  clampForQuestion,
} from '../neon/functions/submit-response/answerShape.js';
import { ADDRESS_MAX } from '@/logic/address.js';
import { CONTACT_MAX } from '@/logic/contact.js';
import { resetFnDb, type newFnDbState } from './_fnDb.js';

const db = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof newFnDbState> }));

vi.mock('pg', async () => {
  const m = await import('./_fnDb.js');
  db.state = m.newFnDbState();
  return { Pool: m.fnDbPool(db.state) };
});

const FORM = 'f_wavebform001';
const IP = '203.0.113.64';

const schema = {
  brand: { name: 'Roofing' },
  estimate: { base: 150, currency: 'USD' },
  questions: [
    {
      id: 'plan',
      type: 'single_choice',
      title: 'Package',
      display: 'cards',
      options: [
        { label: 'Basic', value: 'basic', price: 2400 },
        { label: 'Standard', value: 'standard', price: 5200, priceMax: 6100 },
      ],
    },
    {
      id: 'n',
      type: 'number',
      title: 'Skylights',
      unit: 'skylights',
      unitPrice: 300,
      min: 0,
      max: 10,
    },
    { id: 'who', type: 'contact_info', title: 'Reach you?' },
    { id: 'addr', type: 'address', title: 'Where?', serviceArea: ['931'] },
    { id: 'sig', type: 'signature', title: 'Sign', required: true },
    { id: 'done', type: 'thanks', title: 'Thanks', showEstimate: true },
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
    slug: '12345678',
    status: 'published',
    deleted_at: null,
    owner_id: 'u_owner_b',
    fill_password_hash: null,
    published_schema: schema,
  });
});

const meta = (extra: Record<string, unknown> = {}) => ({
  startedAt: '2026-09-29T10:00:00.000Z',
  completedAt: '2026-09-29T10:02:00.000Z',
  durationMs: 120000,
  questionsVisited: ['plan'],
  hiddenFields: {},
  score: 0,
  ...extra,
});

const submit = (answers: Record<string, unknown>, extraMeta: Record<string, unknown> = {}) =>
  app.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
    body: JSON.stringify({ formId: FORM, answers, meta: meta(extraMeta) }),
  });

const stored = () =>
  db.state.submissions[0] as { answers: Record<string, unknown>; meta: Record<string, unknown> };

describe('clampForQuestion: Wave B shapes', () => {
  const contact = { id: 'c', type: 'contact_info' };
  const address = { id: 'a', type: 'address' };
  const sig = { id: 's', type: 'signature' };

  it('the part caps match the engine’s', () => {
    expect(CONTACT_PART_MAX).toEqual(CONTACT_MAX);
    expect(ADDRESS_PART_MAX).toEqual(ADDRESS_MAX);
  });

  it('contact: known parts only, trimmed and capped; nothing left is dropped', () => {
    expect(
      clampForQuestion(contact, {
        name: '  Ada ',
        email: 'a@b.co',
        phone: 5,
        toString: 'x',
        extra: 'y',
      }),
    ).toEqual({ name: 'Ada', email: 'a@b.co' });
    expect(
      (clampForQuestion(contact, { name: 'x'.repeat(500) }) as { name: string }).name,
    ).toHaveLength(120);
    expect(clampForQuestion(contact, { name: '  ' })).toBeUndefined();
    expect(clampForQuestion(contact, 'Ada')).toBeUndefined();
    expect(clampForQuestion(contact, ['Ada'])).toBeUndefined();
  });

  it('address: known parts only, trimmed and capped', () => {
    expect(
      clampForQuestion(address, {
        street: ' 12 Palm ',
        postal: '93101',
        lat: '34.4',
        city: { x: 1 },
      }),
    ).toEqual({ street: '12 Palm', postal: '93101' });
    expect(
      (clampForQuestion(address, { postal: '9'.repeat(40) }) as { postal: string }).postal,
    ).toHaveLength(20);
  });

  it('signature: a path the engine could write, or a typed name; anything else is dropped', () => {
    expect(clampForQuestion(sig, { path: 'M10 20l5 -3' })).toEqual({ path: 'M10 20l5 -3' });
    expect(clampForQuestion(sig, { path: 'M10 20l5 -3', typed: 'x', img: 'data:' })).toEqual({
      path: 'M10 20l5 -3',
    });
    expect(clampForQuestion(sig, { path: '<svg onload=alert(1)>' })).toBeUndefined();
    expect(clampForQuestion(sig, { path: `M1 1l${'1 0 '.repeat(3000)}1 0` })).toBeUndefined();
    expect(clampForQuestion(sig, { typed: '  Ada Lovelace ' })).toEqual({ typed: 'Ada Lovelace' });
    expect(
      (clampForQuestion(sig, { typed: 'x'.repeat(300) }) as { typed: string }).typed,
    ).toHaveLength(100);
    expect(clampForQuestion({ ...sig, allowTyped: false }, { typed: 'Ada' })).toBeUndefined();
    expect(clampForQuestion(sig, 'M10 20')).toBeUndefined();
  });
});

describe('submit: the stored estimate is the server’s own', () => {
  it('recomputes from the published prices and ignores a forged client estimate', async () => {
    const res = await submit(
      { plan: 'standard', n: 2 },
      { estimate: { low: 1, high: 1, currency: 'USD', lines: [] } },
    );
    expect(res.status).toBe(200);
    expect(stored().meta.estimate).toEqual({
      low: 150 + 5200 + 600,
      high: 150 + 6100 + 600,
      currency: 'USD',
      lines: [
        { id: '_base', label: 'Base price', low: 150, high: 150 },
        { id: 'plan', label: 'Standard', low: 5200, high: 6100 },
        { id: 'n', label: 'Skylights', qty: 2, low: 600, high: 600 },
      ],
    });
  });

  it('a quantity past the question’s max prices nothing, whatever the client claims', async () => {
    await submit({ plan: 'basic', n: 5000 }, { estimate: { low: 999999, high: 999999 } });
    expect(stored().meta.estimate).toMatchObject({ low: 150 + 2400, high: 150 + 2400 });
  });

  it('answers to questions not in the published schema never reach the estimate', async () => {
    await submit({ plan: 'basic', ghost: 'premium', n: '3' });
    // '3' is numeric text: the number clamp turns it into 3.
    expect(stored().answers).toEqual({ plan: 'basic', n: 3 });
    expect(stored().meta.estimate).toMatchObject({ low: 150 + 2400 + 900 });
  });

  it('a form without prices stores no estimate, even if the client sends one', async () => {
    db.state.forms.set(FORM, {
      ...db.state.forms.get(FORM)!,
      published_schema: { questions: [{ id: 'q', type: 'short_text', title: 'Q' }] },
    });
    await submit({ q: 'hi' }, { estimate: { low: 5, high: 5, currency: 'USD', lines: [] } });
    expect(stored().meta).not.toHaveProperty('estimate');
  });

  it('stores contact, address and signature answers in their clamped shapes', async () => {
    await submit({
      who: { name: 'Ada', email: 'ada@example.com', phone: '+18055550100', note: 'x' },
      addr: { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' },
      sig: { path: 'M40 150l50 -90 50 90 50 -90' },
    });
    expect(stored().answers).toEqual({
      who: { name: 'Ada', email: 'ada@example.com', phone: '+18055550100' },
      addr: { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' },
      sig: { path: 'M40 150l50 -90 50 90 50 -90' },
    });
    // No priced answer, but the base still quotes.
    expect(stored().meta.estimate).toMatchObject({ low: 150, high: 150 });
  });

  it('a forged signature is dropped, the rest of the response is kept', async () => {
    await submit({ plan: 'basic', sig: { path: 'M0 0L9999 9999<script>' } });
    expect(stored().answers).toEqual({ plan: 'basic' });
  });
});
