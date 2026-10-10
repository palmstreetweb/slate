/**
 * Audit fixes (2026-10-09) on portable links and the studio's answers view:
 * a date keeps its format, malformed conditions never reach the engine (and
 * the engine shrugs them off anyway), lists are capped, a link without an
 * ending gets one, a link's form id is trusted only where it can't be
 * anyone's form, and a map link needs real coordinates.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question, Schema } from '@/index.js';
import { evaluate } from '@/logic/conditional.js';
import { visibleQuestions } from '@/logic/progress.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import { PublicRespond, tokenId } from '../examples/_admin/pages/PublicRespond.js';
import { encodePortableSchema } from '../examples/_admin/portableShare.js';
import { listSubmissions } from '../examples/_admin/_submissionStore.js';
import { createForm } from '../examples/_admin/_formsStore.js';
import { LocationAnswer } from '../examples/_admin/responses/WaveCAnswers.js';

vi.mock('../examples/_admin/neon/config.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isNeonConfigured: () => false,
}));

const base = { brand: { name: 'X' }, theme: 'classic', themeMode: 'light' } as const;
const thanks: Question = { id: 'done', type: 'thanks', title: 'Thanks' };
const q = (schema: Schema, id: string) =>
  schema.questions.find((x) => x.id === id) as Record<string, unknown>;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe('sanitizer: a date keeps its format (bug 6)', () => {
  it('DD/MM/YYYY survives; an address keeps us / international; junk goes', () => {
    const out = sanitizeUntrustedSchema({
      ...base,
      questions: [
        { id: 'd', type: 'date', title: 'D', format: 'DD/MM/YYYY' },
        { id: 'd2', type: 'date', title: 'D', format: 'YYYY' },
        { id: 'a', type: 'address', title: 'A', format: 'international' },
        { id: 'a2', type: 'address', title: 'A', format: 'DD/MM/YYYY' },
        { id: 't', type: 'short_text', title: 'T', format: 'us' },
        thanks,
      ],
    } as unknown as Schema);
    expect(q(out, 'd').format).toBe('DD/MM/YYYY');
    expect(q(out, 'd2').format).toBeUndefined();
    expect(q(out, 'a').format).toBe('international');
    expect(q(out, 'a2').format).toBeUndefined();
    expect(q(out, 't').format).toBeUndefined();
  });
});

describe('sanitizer: conditions and jumps only in shapes the engine reads (F2)', () => {
  it('drops malformed visibleIf and logic, keeps well-formed ones', () => {
    const out = sanitizeUntrustedSchema({
      ...base,
      questions: [
        { id: 'a', type: 'short_text', title: 'A', visibleIf: 5 },
        { id: 'b', type: 'short_text', title: 'B', visibleIf: { all: 'x' } },
        { id: 'c', type: 'short_text', title: 'C', logic: 'x' },
        {
          id: 'd',
          type: 'short_text',
          title: 'D',
          logic: [{ if: 5 }, { if: { field: 'a', op: 'is_empty' } }],
        },
        {
          id: 'e',
          type: 'short_text',
          title: 'E',
          visibleIf: {
            any: [
              { field: 'a', op: 'equals', value: 'x' },
              { field: 'n', op: 'gt', value: 2 },
            ],
          },
          logic: [{ if: { field: 'a', op: 'in', value: ['x', 1] }, goTo: 'done' }],
        },
        {
          id: 'f',
          type: 'short_text',
          title: 'F',
          visibleIf: { field: 'a', op: 'gt', value: 'big' },
        },
        {
          id: 'g',
          type: 'short_text',
          title: 'G',
          visibleIf: { field: 'a', op: 'nope', value: 1 },
        },
        thanks,
      ],
    } as unknown as Schema);
    expect(q(out, 'a').visibleIf).toBeUndefined();
    expect(q(out, 'b').visibleIf).toBeUndefined();
    expect(q(out, 'c').logic).toBeUndefined();
    expect(q(out, 'd').logic).toBeUndefined();
    expect(q(out, 'e').visibleIf).toEqual({
      any: [
        { field: 'a', op: 'equals', value: 'x' },
        { field: 'n', op: 'gt', value: 2 },
      ],
    });
    expect(q(out, 'e').logic).toEqual([
      { if: { field: 'a', op: 'in', value: ['x', 1] }, goTo: 'done' },
    ]);
    expect(q(out, 'f').visibleIf).toBeUndefined();
    expect(q(out, 'g').visibleIf).toBeUndefined();
  });

  it('caps the questions and every option, row and column list', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: `v${i}` }));
    const out = sanitizeUntrustedSchema({
      ...base,
      questions: [
        { id: 'm', type: 'matrix', title: 'M', rows: many(150), columns: many(120) },
        { id: 'p', type: 'multi_choice', title: 'P', options: many(130) },
        ...Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, type: 'short_text', title: 'T' })),
      ],
    } as unknown as Schema);
    expect(out.questions.length).toBeLessThanOrEqual(201);
    expect((q(out, 'm').rows as unknown[]).length).toBe(100);
    expect((q(out, 'm').columns as unknown[]).length).toBe(100);
    expect((q(out, 'p').options as unknown[]).length).toBe(100);
  });
});

describe('engine: a condition that isn’t one never crashes (F2)', () => {
  it('evaluate says false for anything it can’t read; a question with such a visibleIf still shows', () => {
    expect(evaluate(5 as never, {})).toBe(false);
    expect(evaluate(null as never, {})).toBe(false);
    expect(evaluate({ all: 'x' } as never, {})).toBe(false);
    expect(evaluate({ any: 'x' } as never, {})).toBe(false);
    const shown = visibleQuestions(
      [
        { id: 'a', type: 'short_text', title: 'A', visibleIf: 5 } as unknown as Question,
        { id: 'b', type: 'short_text', title: 'B', visibleIf: { all: 'x' } } as unknown as Question,
        { id: 'c', type: 'short_text', title: 'C', visibleIf: { field: 'z', op: 'is_empty' } },
      ],
      {},
    ).map((x) => x.id);
    expect(shown).toEqual(['a', 'c']);
  });
});

describe('sanitizer: a link without an ending gets one (bug 17)', () => {
  it('appends a plain Thank You so OK on the last question goes somewhere', () => {
    const out = sanitizeUntrustedSchema({
      ...base,
      questions: [{ id: 'n', type: 'short_text', title: 'N' }],
    } as unknown as Schema);
    expect(out.questions.map((x) => x.type)).toEqual(['short_text', 'thanks']);
    const kept = sanitizeUntrustedSchema({
      ...base,
      questions: [{ id: 'n', type: 'short_text', title: 'N' }, thanks],
    } as unknown as Schema);
    expect(kept.questions.map((x) => x.id)).toEqual(['n', 'done']);
  });
});

describe('portable link: the form id it names (F3)', () => {
  const schema: Schema = {
    ...base,
    questions: [{ id: 'name', type: 'short_text', title: 'Your name?', required: true }, thanks],
  };

  it('an id that could be another form’s is replaced by a hash of the link', async () => {
    const token = encodePortableSchema(schema, { formId: 'f_victim' });
    const user = userEvent.setup();
    render(<PublicRespond token={token} />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await screen.findByRole('heading', { name: 'Thanks' });
    expect(listSubmissions('f_victim')).toHaveLength(0);
    expect(listSubmissions(tokenId(token))).toHaveLength(1);
    expect(window.sessionStorage.getItem('slate-forms-resume:f_victim')).toBeNull();
  });

  it('a portable_ id, or the id of a form kept in this browser, is kept', async () => {
    const own = createForm({ name: 'Mine', schema })!;
    const token = encodePortableSchema(schema, { formId: own.id });
    const user = userEvent.setup();
    render(<PublicRespond token={token} />);
    await user.type(await screen.findByRole('textbox'), 'Ada{Enter}');
    await screen.findByRole('heading', { name: 'Thanks' });
    expect(listSubmissions(own.id)).toHaveLength(1);
    cleanup();
    const portable = encodePortableSchema(schema, { formId: 'portable_abc' });
    render(<PublicRespond token={portable} />);
    await user.type(await screen.findByRole('textbox'), 'Bea{Enter}');
    await screen.findByRole('heading', { name: 'Thanks' });
    expect(listSubmissions('portable_abc')).toHaveLength(1);
  });
});

describe('answers view: the map link needs real coordinates (F7)', () => {
  const loc = {
    id: 'where',
    type: 'location',
    title: 'Where?',
    center: { lat: 34.4208, lng: -119.6982 },
    radius: 25,
  } as Extract<Question, { type: 'location' }>;

  it('no link for "NaN", a link for numbers', () => {
    const { container, rerender } = render(
      <LocationAnswer
        question={loc}
        value={{ lat: 'abc', lng: '-119.8', area: 'in' }}
        form={[loc]}
      />,
    );
    expect(container.querySelector('a')).toBeNull();
    rerender(
      <LocationAnswer
        question={loc}
        value={{ lat: '34.441', lng: '-119.812', area: 'in' }}
        form={[loc]}
      />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toContain(
      'mlat=34.441&mlon=-119.812',
    );
  });
});
