/**
 * Studio surfaces for Wave B (ADR-064): Responses formatting, CSV columns, the
 * Summary model (names from a contact block, ZIPs and service area, estimate
 * stats), stored-estimate normalizing, portable-schema sanitizing, Build with
 * AI mapping, the editor's sample estimate, and backup round trips.
 */

import { describe, expect, it } from 'vitest';
import type { Estimate, Question, Schema } from '@/index.js';
import { IN_AREA_VALUE, OUT_OF_AREA_VALUE } from '@/logic/address.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import {
  csvParts,
  formatAnswerForCsv,
  formatAnswerForQuestion,
  leadPreview,
} from '../examples/_admin/responsesFormat.js';
import { buildResponsesCsv } from '../examples/_admin/csvExport.js';
import {
  answerMatchesFilter,
  chartableQuestions,
  estimateStats,
  namedRespondent,
  questionDistribution,
  respondentEmail,
} from '../examples/_admin/responses/model.js';
import { normalizeEstimate, normalizeMeta } from '../examples/_admin/answerShape.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import { sampleEstimate, sampleEstimateAnswers } from '../examples/_admin/estimatePreview.js';
import { buildBackup, parseBackup, serializeBackup } from '../examples/_admin/dataBackup.js';
import { generatedFormSchema, withDraftDefaults } from '../api/generateFormSchema.js';
import { blankGeneratedQuestion, mapGeneratedForm } from '../api/mapGeneratedForm.js';
import { checkSchema } from '@/logic/schemaCheck.js';

const contact: Question = { id: 'who', type: 'contact_info', title: 'How can we reach you?' };
const address: Question = {
  id: 'addr',
  type: 'address',
  title: 'Job address',
  serviceArea: ['931', '93455'],
};
const signature: Question = { id: 'sig', type: 'signature', title: 'Sign' };
const plan: Question = {
  id: 'plan',
  type: 'single_choice',
  title: 'Package',
  options: [
    { label: 'Basic', value: 'basic', price: 2400 },
    { label: 'Premium', value: 'premium', price: 9800, priceMax: 12000 },
  ],
};

/** Split one CSV row, honouring quoted cells. */
function cellsOf(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const est = (low: number, high: number, currency = 'USD'): Estimate => ({
  low,
  high,
  currency,
  lines: [{ id: 'plan', label: 'Basic', low, high }],
});

let n = 0;
function sub(answers: Record<string, unknown>, estimate?: Estimate): StoredSubmission {
  n += 1;
  return {
    id: `s_${n}`,
    formId: 'f_1',
    receivedAt: `2026-09-${String(10 + (n % 15)).padStart(2, '0')}T10:00:00.000Z`,
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: '',
      completedAt: '',
      durationMs: 60_000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
      ...(estimate ? { estimate } : {}),
    },
  };
}

const ada = { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+18055550100' };
const home = { street: '12 Palm St', city: 'Santa Barbara', region: 'CA', postal: '93101' };
const far = { street: '1 Main St', city: 'Fresno', region: 'CA', postal: '93701' };

describe('Responses formatting', () => {
  it('contact: one part per line; address: one line, flagged outside the area', () => {
    // The phone as people write it, not as stored (copy QA).
    expect(formatAnswerForQuestion(contact, ada)).toBe(
      'Ada Lovelace\nada@example.com\n(805) 555-0100',
    );
    expect(formatAnswerForQuestion(contact, {})).toBe('—');
    expect(formatAnswerForQuestion(address, home)).toBe('12 Palm St, Santa Barbara, CA 93101');
    expect(formatAnswerForQuestion(address, far)).toBe(
      '1 Main St, Fresno, CA 93701 (outside service area)',
    );
  });

  it('signature: "Signed" or the typed name — never the raw path', () => {
    expect(formatAnswerForQuestion(signature, { path: 'M1 1l50 0' })).toBe('Signed');
    expect(formatAnswerForQuestion(signature, { typed: 'Ada' })).toBe('Typed: Ada');
    expect(formatAnswerForCsv(signature, { path: 'M1 1l50 0' })).toBe('Signed (drawn)');
    expect(formatAnswerForCsv(signature, { typed: 'Ada' })).toBe('Typed: Ada');
  });

  it('hostile shapes still format without throwing', () => {
    for (const v of [42, 'x', ['a'], { toString: 1 }, null]) {
      expect(typeof formatAnswerForQuestion(contact, v)).toBe('string');
      expect(typeof formatAnswerForQuestion(address, v)).toBe('string');
      expect(typeof formatAnswerForQuestion(signature, v)).toBe('string');
    }
  });

  it('a contact block leads the collapsed row', () => {
    const q: Question[] = [{ id: 'note', type: 'short_text', title: 'Note' }, contact];
    expect(leadPreview(q, { note: 'hi', who: ada }).primary).toBe('Ada Lovelace');
  });
});

describe('CSV', () => {
  it('splits a contact block and an address into a column per part, with the area', () => {
    expect(csvParts(contact)!.map((p) => p.label)).toEqual(['Name', 'Email', 'Phone']);
    expect(csvParts(address)!.map((p) => p.label)).toEqual([
      'Street',
      'Unit',
      'City',
      'State',
      'ZIP',
      'In service area',
    ]);
    expect(csvParts(plan)).toBeNull();
    const csv = buildResponsesCsv(
      [contact, address, signature, plan],
      [sub({ who: ada, addr: far, sig: { typed: 'Ada' }, plan: 'basic' }, est(2400, 2400))],
    );
    const [head, row] = csv.split('\r\n');
    expect(head).toBe(
      [
        'Submitted',
        'Time spent',
        'Score',
        'Estimate low (USD)',
        'Estimate high (USD)',
        'Source',
        'How can we reach you? — Name',
        'How can we reach you? — Email',
        'How can we reach you? — Phone',
        'Job address — Street',
        'Job address — Unit',
        'Job address — City',
        'Job address — State',
        'Job address — ZIP',
        'Job address — In service area',
        'Sign',
        'Package',
      ].join(','),
    );
    const cells = cellsOf(row!);
    expect(cells.slice(3, 5)).toEqual(['2400', '2400']);
    expect(cells.slice(6, 9)).toEqual(['Ada Lovelace', 'ada@example.com', '+18055550100']);
    expect(cells.slice(9, 15)).toEqual(['1 Main St', '', 'Fresno', 'CA', '93701', 'No']);
    expect(cells.slice(15)).toEqual(['Typed: Ada', 'Basic']);
  });

  it('no estimate columns when no response has one', () => {
    const csv = buildResponsesCsv([plan], [sub({ plan: 'basic' })]);
    expect(csv.split('\r\n')[0]).toBe('Submitted,Time spent,Score,Source,Package');
  });
});

describe('Summary model', () => {
  it('a contact block names the respondent and gives the reply address', () => {
    const qs = [{ id: 'first', type: 'short_text', title: 'Your name' } as Question, contact];
    expect(namedRespondent(qs, { first: 'Someone', who: ada })).toBe('Ada Lovelace');
    expect(respondentEmail(qs, { who: ada })).toBe('ada@example.com');
    expect(respondentEmail(qs, { who: { email: 'bad@@x' } })).toBeNull();
  });

  it('an address with a service area charts inside vs outside, ZIPs listed', () => {
    expect(chartableQuestions([address, contact, signature]).map((q) => q.id)).toEqual(['addr']);
    const subs = [
      sub({ addr: home }),
      sub({ addr: far }),
      sub({ addr: { ...home, postal: '93455-1111' } }),
      sub({}),
    ];
    const d = questionDistribution(address, subs);
    expect(d.answered).toBe(3);
    expect(d.rows.map((r) => [r.label, r.count])).toEqual([
      ['In area', 2],
      ['Out of area', 1],
    ]);
    expect(d.others!.map((o) => o.text)).toEqual(
      ['93101', '934551111', '93701'].map((z) => (z === '934551111' ? '93455-1111' : z)),
    );
    expect(
      answerMatchesFilter(subs[1]!, { questionId: 'addr', value: OUT_OF_AREA_VALUE }, address),
    ).toBe(true);
    expect(
      answerMatchesFilter(subs[0]!, { questionId: 'addr', value: IN_AREA_VALUE }, address),
    ).toBe(true);
    expect(
      answerMatchesFilter(subs[0]!, { questionId: 'addr', value: OUT_OF_AREA_VALUE }, address),
    ).toBe(false);
  });

  it('an address without an area charts by ZIP', () => {
    const plain = { ...address, serviceArea: undefined } as Question;
    const d = questionDistribution(plain, [
      sub({ addr: home }),
      sub({ addr: home }),
      sub({ addr: far }),
    ]);
    expect(d.rows.map((r) => [r.label, r.count])).toEqual([
      ['93101', 2],
      ['93701', 1],
    ]);
    expect(
      answerMatchesFilter(sub({ addr: home }), { questionId: 'addr', value: '93101' }, plain),
    ).toBe(true);
  });

  it('estimate stats: average of midpoints, range, total, in the newest currency', () => {
    const stats = estimateStats([
      sub({}, est(2000, 3000)),
      sub({}, est(5000, 7000)),
      sub({}),
      sub({}, est(10, 10, 'EUR')),
    ]);
    expect(stats).toEqual({
      count: 2,
      currency: 'USD',
      average: 4250,
      low: 2000,
      high: 7000,
      total: 8500,
    });
    expect(estimateStats([sub({})])).toBeNull();
  });
});

describe('stored estimates are untrusted on load', () => {
  it('keeps a well-formed estimate, clamps and drops the rest', () => {
    expect(normalizeEstimate(est(10, 20))).toEqual(est(10, 20));
    expect(normalizeEstimate({ low: 'x', high: 2 })).toBeUndefined();
    expect(
      normalizeEstimate({ low: 5, high: 2, currency: 'dollars', lines: [{ label: 3 }, 'x'] }),
    ).toEqual({
      low: 5,
      high: 5,
      currency: 'USD',
      lines: [],
    });
    expect(normalizeEstimate({ low: 1e20, high: 1e20 })!.low).toBe(1e9);
    expect(normalizeMeta({ estimate: est(1, 2) }).estimate).toEqual(est(1, 2));
    expect(normalizeMeta({ estimate: 'x' })).not.toHaveProperty('estimate');
  });
});

describe('portable schemas (sanitizeUntrustedSchema)', () => {
  it('keeps sane Wave B options and drops junk', () => {
    const out = sanitizeUntrustedSchema({
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      estimate: {
        currency: 'CAD',
        base: 99,
        baseMax: 'x',
        disclaimer: 'y'.repeat(500),
        breakdown: 'yes',
        evil: 1,
      },
      questions: [
        {
          ...plan,
          display: 'cards',
          options: [
            {
              label: 'A',
              value: 'a',
              price: 5,
              priceMax: Infinity,
              badge: 'z'.repeat(50),
              features: ['f', 3, 'g'],
            },
            { label: 'B', value: 'b', price: 'free' },
          ],
        },
        { id: 'n', type: 'number', title: 'N', unitPrice: 45, unitPriceMax: 'x' },
        {
          ...contact,
          fields: { name: 'required', email: 'nope', phone: 'off' },
          defaultCountry: 'usa',
        },
        { ...address, line2: 'no', country: true, format: 'mars', serviceArea: ['93101', 5] },
        { ...signature, allowTyped: false, body: 'b'.repeat(3000) },
        { id: 'done', type: 'thanks', title: 'T', showEstimate: 'yes' },
      ],
    } as unknown as Schema);
    expect(out.estimate).toEqual({ currency: 'CAD', base: 99, disclaimer: 'y'.repeat(200) });
    const [p, num, c, a, s, t] = out.questions as unknown as Array<Record<string, unknown>>;
    expect(p!.display).toBe('cards');
    expect(p!.options).toEqual([
      { label: 'A', value: 'a', price: 5, badge: 'z'.repeat(24), features: ['f', 'g'] },
      { label: 'B', value: 'b' },
    ]);
    expect(num).toMatchObject({ unitPrice: 45 });
    expect(num).not.toHaveProperty('unitPriceMax');
    expect(c!.fields).toEqual({ name: 'required', phone: 'off' });
    expect(c).not.toHaveProperty('defaultCountry');
    expect(a).toMatchObject({ country: true, serviceArea: ['93101'] });
    expect(a).not.toHaveProperty('line2');
    expect(a).not.toHaveProperty('format');
    expect(s!.allowTyped).toBe(false);
    expect((s!.body as string).length).toBe(2000);
    expect(t).not.toHaveProperty('showEstimate');
  });
});

describe('Build with AI', () => {
  const opt = (label: string, value: string, extra: Record<string, unknown> = {}) => ({
    label,
    value,
    src: '',
    alt: '',
    price: 0,
    priceMax: 0,
    features: [] as string[],
    badge: '',
    capacity: 0,
    date: '',
    start: '',
    end: '',
    ...extra,
  });
  const draft = (
    questions: ReturnType<typeof blankGeneratedQuestion>[],
    estimate = { show: false, currency: 'USD', base: 0, disclaimer: '' },
  ) => ({
    title: 'Roof quote',
    description: 'Get a price.',
    theme: 'swiss' as const,
    welcome: { title: 'Welcome.', subtitle: 'Quick quote.', cta: 'Start' },
    questions,
    thanks: { title: 'Thank you.', subtitle: '', cta: 'Done' },
    estimate,
  });

  it('maps package cards with prices, contact / address / signature, and the estimate ending', () => {
    const parsed = generatedFormSchema.parse(
      draft(
        [
          blankGeneratedQuestion({
            id: 'package',
            type: 'single_choice',
            title: 'Pick a package',
            required: true,
            display: 'cards',
            options: [
              opt('Basic', 'basic', { price: 2400, features: ['Patch', ' ', 'Seal'] }),
              opt('Premium', 'premium', { price: 9800, priceMax: 12000, badge: 'Most popular' }),
            ],
          }),
          blankGeneratedQuestion({
            id: 'skylights',
            type: 'number',
            title: 'Skylights?',
            unitPrice: 300,
            unit: 'skylights',
          }),
          blankGeneratedQuestion({
            id: 'contact',
            type: 'contact_info',
            title: 'How can we reach you?',
          }),
          blankGeneratedQuestion({
            id: 'where',
            type: 'address',
            title: 'Address?',
            required: true,
            serviceArea: ['93101', 'bad!'],
          }),
          blankGeneratedQuestion({
            id: 'sign',
            type: 'signature',
            title: 'Sign',
            body: 'I approve.',
            required: true,
          }),
        ],
        { show: true, currency: 'USD', base: 150, disclaimer: 'Final price after inspection' },
      ),
    );
    const { schema } = mapGeneratedForm(parsed);
    const byId = Object.fromEntries(schema.questions.map((q) => [q.id, q])) as Record<
      string,
      Question
    >;
    expect(byId.package).toMatchObject({
      display: 'cards',
      options: [
        { label: 'Basic', value: 'basic', price: 2400, features: ['Patch', 'Seal'] },
        { label: 'Premium', value: 'premium', price: 9800, priceMax: 12000, badge: 'Most popular' },
      ],
    });
    expect(byId.skylights).toMatchObject({ unitPrice: 300 });
    expect(byId.contact).toEqual({
      id: 'contact',
      type: 'contact_info',
      title: 'How can we reach you?',
    });
    expect(byId.where).toMatchObject({ type: 'address', required: true, serviceArea: ['93101'] });
    expect(byId.sign).toMatchObject({ type: 'signature', body: 'I approve.', required: true });
    expect(schema.estimate).toEqual({
      base: 150,
      disclaimer: 'Final price after inspection',
      breakdown: true,
    });
    expect(schema.questions.at(-1)).toMatchObject({ type: 'thanks', showEstimate: true });
    expect(checkSchema(schema.questions)).toEqual([]);
  });

  it('never shows an estimate the draft has nothing to price for', () => {
    const parsed = generatedFormSchema.parse(
      draft(
        [
          blankGeneratedQuestion({ id: 'a', type: 'short_text', title: 'A' }),
          blankGeneratedQuestion({
            id: 'b',
            type: 'single_choice',
            title: 'B',
            options: [opt('X', 'x'), opt('Y', 'y')],
          }),
          blankGeneratedQuestion({ id: 'c', type: 'email', title: 'C' }),
        ],
        { show: true, currency: 'USD', base: 0, disclaimer: '' },
      ),
    );
    const { schema } = mapGeneratedForm(parsed);
    expect(schema.estimate).toBeUndefined();
    expect(schema.questions.at(-1)).not.toHaveProperty('showEstimate');
    expect((schema.questions[2] as unknown as { options: object[] }).options).toEqual([
      { label: 'X', value: 'x' },
      { label: 'Y', value: 'y' },
    ]);
  });

  it('a draft from before Wave B still validates for a revise', () => {
    const old = {
      ...draft([
        blankGeneratedQuestion({ id: 'a', type: 'short_text', title: 'A' }),
        blankGeneratedQuestion({ id: 'b', type: 'short_text', title: 'B' }),
        blankGeneratedQuestion({
          id: 'c',
          type: 'single_choice',
          title: 'C',
          options: [opt('X', 'x'), opt('Y', 'y')],
        }),
      ]),
    } as Record<string, unknown>;
    delete old.estimate;
    old.questions = (old.questions as Array<Record<string, unknown>>).map((q) => {
      const { unitPrice: _u, serviceArea: _s, ...rest } = q;
      return {
        ...rest,
        options: (rest.options as Array<Record<string, unknown>>).map(
          ({ label, value, src, alt }) => ({ label, value, src, alt }),
        ),
      };
    });
    expect(generatedFormSchema.safeParse(old).success).toBe(false);
    expect(generatedFormSchema.safeParse(withDraftDefaults(old)).success).toBe(true);
  });
});

describe('editor preview estimate', () => {
  it('picks the first priced option and one unit (or the minimum)', () => {
    const qs: Question[] = [
      plan,
      { id: 'n', type: 'number', title: 'N', unitPrice: 50, min: 2 },
      {
        id: 'm',
        type: 'multi_choice',
        title: 'M',
        options: [
          { label: 'X', value: 'x' },
          { label: 'Y', value: 'y', price: 5 },
        ],
      },
    ];
    expect(sampleEstimateAnswers({ questions: qs })).toEqual({ plan: 'basic', n: 2, m: ['y'] });
    expect(sampleEstimate({ questions: qs, estimate: { base: 1 } })).toMatchObject({
      low: 1 + 2400 + 100 + 5,
    });
    expect(sampleEstimate({ questions: [contact] })).toBeNull();
  });
});

describe('backup', () => {
  it('round-trips Wave B answers and the stored estimate', () => {
    const s = sub({ who: ada, addr: home, sig: { path: 'M1 1l60 0' } }, est(10, 20));
    const back = parseBackup(serializeBackup(buildBackup([], [s])));
    expect(back!.submissions[0]).toEqual(s);
  });
});
