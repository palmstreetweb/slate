/**
 * Build with AI never drafts a pick limit nobody can meet (QA 2026-10: CH-04,
 * CH-08): whole numbers, Min within the choices (counting "Other") and at least
 * 1 when the draft says required, Max kept only when it limits something.
 */

import { describe, expect, it } from 'vitest';
import { generatedFormSchema } from '../api/generateFormSchema.js';
import { blankGeneratedQuestion, mapGeneratedForm } from '../api/mapGeneratedForm.js';
import { formIssues } from '../examples/_admin/formChecks.js';

const opt = (label: string, value: string) => ({
  label,
  value,
  src: `https://example.com/${value}.jpg`,
  alt: '',
  price: 0,
  priceMax: 0,
  features: [] as string[],
  badge: '',
  capacity: 0,
  date: '',
  start: '',
  end: '',
});

const four = [
  opt('Roof', 'roof'),
  opt('Gutters', 'gutters'),
  opt('Siding', 'siding'),
  opt('Windows', 'windows'),
];

function mapOne(q: Parameters<typeof blankGeneratedQuestion>[0]) {
  const draft = generatedFormSchema.parse({
    title: 'Quote',
    description: 'A roofing quote.',
    theme: 'editorial',
    welcome: { title: 'Hi', subtitle: '', cta: 'Start' },
    // The draft schema wants at least three questions.
    questions: [
      blankGeneratedQuestion(q),
      blankGeneratedQuestion({ id: 'name', type: 'short_text', title: 'Your name?' }),
      blankGeneratedQuestion({ id: 'notes', type: 'long_text', title: 'Anything else?' }),
    ],
    thanks: { title: 'Thanks', subtitle: '', cta: '' },
    estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
  });
  const { schema } = mapGeneratedForm(draft);
  return { question: schema.questions[1] as Record<string, unknown>, schema };
}

describe('AI pick limits', () => {
  const base = {
    id: 'services',
    type: 'multi_choice' as const,
    title: 'Which services?',
    options: four,
  };

  it('a required multi choice needs at least one pick', () => {
    const { question } = mapOne({ ...base, required: true });
    expect(question.min).toBe(1);
    expect(question.max).toBeUndefined();
  });

  it('an optional one with no limits has none', () => {
    const { question } = mapOne({ ...base, required: false });
    expect(question).not.toHaveProperty('min');
    expect(question).not.toHaveProperty('max');
  });

  it('Min is held to the choices and Max below Min is dropped', () => {
    expect(mapOne({ ...base, min: 6, max: 2 }).question).toMatchObject({ min: 4 });
    expect(mapOne({ ...base, min: 6, max: 2 }).question).not.toHaveProperty('max');
    expect(mapOne({ ...base, min: 6, allowOther: true }).question).toMatchObject({ min: 5 });
    expect(mapOne({ ...base, min: 1.6, max: 2.4 }).question).toMatchObject({ min: 2, max: 2 });
    expect(mapOne({ ...base, min: -3, max: -1 }).question).not.toHaveProperty('max');
  });

  it('picture choice: limits only with multiple; swipe cards never force a like', () => {
    const pic = { ...base, type: 'picture_choice' as const, required: true, min: 9 };
    expect(mapOne({ ...pic, multiple: true }).question).toMatchObject({ min: 4 });
    expect(mapOne({ ...pic, multiple: false }).question).not.toHaveProperty('min');
    const swipe = mapOne({ ...pic, display: 'swipe', min: 0 }).question;
    expect(swipe).toMatchObject({ multiple: true, display: 'swipe' });
    expect(swipe).not.toHaveProperty('min');
  });

  it('what it drafts passes the studio’s checks', () => {
    for (const extra of [
      { min: 6, max: 2 },
      { min: 0, max: 9 },
      { min: 2, max: 3 },
    ]) {
      const { schema } = mapOne({ ...base, required: true, ...extra });
      expect(formIssues(schema.questions).filter((i) => i.questionId === 'services')).toEqual([]);
    }
  });
});
