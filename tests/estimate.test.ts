/**
 * Instant estimate (ADR-064): the pure calculation, formatting, the schema
 * check, and — the trust part — that the submit Function's copy is the same
 * code and lands on the same number for any schema and answers.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Question, Schema } from '@/index.js';
import {
  PRICE_MAX,
  QTY_MAX,
  computeEstimate,
  estimateCurrency,
  estimateFraction,
  formatEstimate,
  formatMoney,
  formatMoneyRange,
  formatPrice,
  hasPricing,
} from '@/logic/estimate.js';
import { checkSchema } from '@/logic/schemaCheck.js';
import { pipe } from '@/logic/piping.js';
import { computeEstimateCore as serverEstimate } from '../neon/functions/submit-response/estimate.js';

const roof: Question = {
  id: 'roof',
  type: 'single_choice',
  title: 'What do you need?',
  options: [
    { label: 'Repair', value: 'repair', price: 450, priceMax: 900 },
    { label: 'Full replacement', value: 'full', price: 8000, priceMax: 12000 },
    { label: 'Not sure', value: 'unsure' },
  ],
};
const extras: Question = {
  id: 'extras',
  type: 'multi_choice',
  title: 'Extras',
  options: [
    { label: 'Gutters', value: 'gutters', price: 600 },
    { label: 'Skylight check', value: 'sky', price: 150, priceMax: 250 },
    { label: 'Nothing', value: 'none' },
  ],
  allowOther: true,
};
const windows: Question = {
  id: 'windows',
  type: 'number',
  title: 'How many windows?',
  display: 'stepper',
  min: 0,
  max: 40,
  unit: 'windows',
  unitPrice: 45,
  unitPriceMax: 60,
};

const schema = (questions: Question[], estimate: Schema['estimate'] = {}) => ({
  questions,
  estimate,
});

describe('computeEstimate', () => {
  it('returns null when nothing on the form has a price', () => {
    const plain: Question = { id: 'n', type: 'short_text', title: 'Name' };
    expect(hasPricing({ questions: [plain] })).toBe(false);
    expect(computeEstimate({ questions: [plain] }, { n: 'Ada' })).toBeNull();
  });

  it('a base price alone prices the form', () => {
    const s = schema([], { base: 99 });
    expect(hasPricing(s)).toBe(true);
    const e = computeEstimate(s, {})!;
    expect(e).toMatchObject({ low: 99, high: 99, currency: 'USD' });
    expect(e.lines).toEqual([{ id: '_base', label: 'Base price', low: 99, high: 99 }]);
  });

  it('adds the base, a picked range, picked extras and quantity × unit price', () => {
    const s = schema([roof, extras, windows], { base: 150, baseLabel: 'Service call' });
    const e = computeEstimate(s, { roof: 'full', extras: ['gutters', 'sky'], windows: 3 })!;
    expect(e.low).toBe(150 + 8000 + 600 + 150 + 135);
    expect(e.high).toBe(150 + 12000 + 600 + 250 + 180);
    expect(e.lines.map((l) => l.label)).toEqual([
      'Service call',
      'Full replacement',
      'Gutters',
      'Skylight check',
      'Windows',
    ]);
    expect(e.lines.at(-1)).toMatchObject({ id: 'windows', qty: 3, low: 135, high: 180 });
  });

  it('unpriced picks, typed Other text and unanswered questions add nothing', () => {
    const e = computeEstimate(schema([roof, extras, windows]), {
      roof: 'unsure',
      extras: ['none', 'Solar panels'],
    })!;
    expect(e).toMatchObject({ low: 0, high: 0, lines: [] });
  });

  it('counts each picked value once and ignores values that are not options', () => {
    const e = computeEstimate(schema([extras]), { extras: ['gutters', 'gutters', 'bogus'] })!;
    expect(e.low).toBe(600);
    expect(e.lines).toHaveLength(1);
  });

  it('a high end below the low end is read as a single price', () => {
    const q: Question = {
      id: 'q',
      type: 'dropdown',
      title: 'Q',
      options: [{ label: 'A', value: 'a', price: 500, priceMax: 100 }],
    };
    expect(computeEstimate(schema([q]), { q: 'a' })).toMatchObject({ low: 500, high: 500 });
  });

  it('zero, quantities outside the question bounds, negative or absurd add nothing', () => {
    for (const n of [0, -1, 41, QTY_MAX + 1, Number.NaN]) {
      const e = computeEstimate(schema([windows]), { windows: n })!;
      expect(e.low, String(n)).toBe(0);
      expect(e.lines, String(n)).toEqual([]);
    }
    const open: Question = { ...windows, min: undefined, max: undefined } as Question;
    expect(computeEstimate(schema([open]), { windows: QTY_MAX + 1 })!.low).toBe(0);
    expect(computeEstimate(schema([open]), { windows: 2.5 })!.low).toBe(112.5);
  });

  it('prices are clamped to PRICE_MAX and totals never go below zero', () => {
    const big: Question = {
      id: 'b',
      type: 'single_choice',
      title: 'B',
      options: [
        { label: 'Huge', value: 'h', price: 1e12 },
        { label: 'Discount', value: 'd', price: -50 },
      ],
    };
    expect(computeEstimate(schema([big]), { b: 'h' })!.low).toBe(PRICE_MAX);
    expect(computeEstimate(schema([big]), { b: 'd' })).toMatchObject({ low: 0, high: 0 });
  });

  it('adds in whole cents, so 0.1 + 0.2 is 0.30', () => {
    const q: Question = {
      id: 'q',
      type: 'multi_choice',
      title: 'Q',
      options: [
        { label: 'A', value: 'a', price: 0.1 },
        { label: 'B', value: 'b', price: 0.2 },
      ],
    };
    expect(computeEstimate(schema([q]), { q: ['a', 'b'] })!.low).toBe(0.3);
  });

  it('keeps at most 40 lines but counts every priced answer', () => {
    const opts = Array.from({ length: 60 }, (_, i) => ({
      label: `O${i}`,
      value: `o${i}`,
      price: 1,
    }));
    const q: Question = { id: 'q', type: 'multi_choice', title: 'Q', options: opts };
    const e = computeEstimate(schema([q]), { q: opts.map((o) => o.value) })!;
    expect(e.low).toBe(60);
    expect(e.lines).toHaveLength(40);
  });

  it('the currency must be a three-letter code', () => {
    expect(estimateCurrency({ currency: 'CAD' })).toBe('CAD');
    expect(estimateCurrency({ currency: 'dollars' })).toBe('USD');
    expect(estimateCurrency(undefined)).toBe('USD');
  });
});

describe('formatting', () => {
  it('formats money, ranges and single prices', () => {
    expect(formatMoney(2400, 'USD')).toBe('$2,400');
    expect(formatMoneyRange(2400, 3100, 'USD')).toBe('$2,400 – $3,100');
    expect(formatMoneyRange(2400, 2400, 'USD')).toBe('$2,400');
    expect(formatPrice(8000, 12000, 'USD')).toBe('$8,000 – $12,000');
    expect(formatPrice(undefined, 5, 'USD')).toBeNull();
    expect(formatPrice(19.5, undefined, 'USD')).toBe('$19.50');
  });

  it('shows cents only when an amount has them', () => {
    const e = { low: 10, high: 12.5, currency: 'USD', lines: [] };
    expect(estimateFraction(e)).toBe(2);
    expect(formatEstimate(e)).toBe('$10.00 – $12.50');
  });

  it('an unknown currency code still prints', () => {
    expect(formatMoney(5, 'ZZZ')).toMatch(/5/);
  });

  it('{{estimate}} pipes the formatted range', () => {
    expect(pipe('Your quote: {{estimate}}', {}, 0, [], '$2,400 – $3,100')).toBe(
      'Your quote: $2,400 – $3,100',
    );
    expect(pipe('Quote: {{ estimate }}', {})).toBe('Quote: ');
  });
});

describe('schemaCheck: prices (ADR-064)', () => {
  it('flags a price that is not a number, too large, or ends below its start', () => {
    const bad = (price: unknown, priceMax?: unknown): Question =>
      ({
        id: 'q',
        type: 'single_choice',
        title: 'Q',
        options: [{ label: 'A', value: 'a', price, priceMax }],
      }) as unknown as Question;
    expect(checkSchema([bad(100, 50)]).map((i) => i.kind)).toEqual(['bad_price']);
    expect(checkSchema([bad(Number.NaN)]).map((i) => i.kind)).toEqual(['bad_price']);
    expect(checkSchema([bad(PRICE_MAX * 2)]).map((i) => i.kind)).toEqual(['bad_price']);
    expect(checkSchema([bad(100, 200)])).toEqual([]);
    expect(checkSchema([{ ...windows, unitPriceMax: 10 } as Question]).map((i) => i.kind)).toEqual([
      'bad_price',
    ]);
  });
});

/* ---------- the server's copy (trust) ---------- */

function sharedSection(path: string): string {
  const text = readFileSync(resolve(path), 'utf8');
  const start = text.indexOf('/* ---------- shared with the server (keep identical) ---------- */');
  const end = text.indexOf('/* ---------- engine-only helpers ---------- */');
  return (end === -1 ? text.slice(start) : text.slice(start, end)).trim();
}

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('the submit Function computes the same estimate', () => {
  it('its estimate code is a byte-for-byte copy of the engine’s', () => {
    const engine = sharedSection('src/logic/estimate.ts');
    const server = sharedSection('neon/functions/submit-response/estimate.ts');
    expect(engine.length).toBeGreaterThan(1000);
    expect(server).toBe(engine);
  });

  it('agrees on 500 random schemas and answers, including junk', () => {
    const r = rng(64);
    const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
    const num = () =>
      pick([0, 1, 12.5, 450, 99.99, -20, 1e9, Number.NaN, undefined, '12' as unknown as number]);
    for (let n = 0; n < 500; n++) {
      const questions: Record<string, unknown>[] = [];
      const answers: Record<string, unknown> = {};
      const count = 1 + Math.floor(r() * 6);
      for (let i = 0; i < count; i++) {
        const id = `q${i}`;
        const type = pick([
          'single_choice',
          'multi_choice',
          'dropdown',
          'picture_choice',
          'number',
          'short_text',
        ]);
        if (type === 'number') {
          questions.push({
            id,
            type,
            title: `Q${i}`,
            unitPrice: num(),
            unitPriceMax: num(),
            min: pick([undefined, 0, 2]),
            max: pick([undefined, 10, 100]),
            unit: pick([undefined, 'rooms']),
          });
          answers[id] = pick([0, 1, 3, 2.5, 150, -2, 'x', null]);
        } else if (type === 'short_text') {
          questions.push({ id, type, title: 'T' });
          answers[id] = 'text';
        } else {
          const opts = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, k) => ({
            label: pick([`Opt ${k}`, '', 'x'.repeat(200)]),
            value: `v${k}`,
            price: num(),
            priceMax: num(),
          }));
          questions.push({ id, type, title: `Q${i}`, options: opts });
          answers[id] =
            type === 'multi_choice'
              ? opts
                  .filter(() => r() > 0.5)
                  .map((o) => o.value)
                  .concat(r() > 0.8 ? ['typed'] : [])
              : pick([...opts.map((o) => o.value), 'other text', 42]);
        }
      }
      const s = {
        questions,
        estimate:
          r() > 0.5
            ? { base: num(), baseMax: num(), currency: pick(['USD', 'EUR', 'nope']) }
            : undefined,
      };
      expect(serverEstimate(s, answers), `case ${n}`).toEqual(
        computeEstimate(s as never, answers as never),
      );
    }
  });
});
