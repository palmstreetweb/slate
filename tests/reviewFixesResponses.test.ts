/**
 * Review fixes, studio (2026-10-05): what respondents typed is never hidden
 * behind "Removed option" (STU-1, CON-02, COPY-R3), the Summary's rows filter
 * to the responses they count (STU-2), and the CSV keeps phones as stored
 * (CON-08). The reader, search, the CSV and the Summary read one text.
 */

import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import { OTHER_VALUE } from '@/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import {
  REMOVED_OPTION,
  formatAnswerForCsv,
  formatAnswerForQuestion,
  isRemovedOptionValue,
} from '../examples/_admin/responsesFormat.js';
import {
  REMOVED_ROW,
  answerMatchesFilter,
  matchesSearch,
  questionDistribution,
} from '../examples/_admin/responses/model.js';
import { buildResponsesCsv } from '../examples/_admin/csvExport.js';

let seq = 0;
function sub(answers: Record<string, unknown>): StoredSubmission {
  seq += 1;
  const iso = new Date(2026, 9, 5, 9, 0).toISOString();
  return {
    id: `s${seq}`,
    formId: 'f1',
    receivedAt: iso,
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: iso,
      completedAt: iso,
      durationMs: 1000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
  } as StoredSubmission;
}

/** "Colour?" with Other turned off after people typed their own (the QA case). */
const colour = {
  id: 'colour',
  type: 'single_choice',
  title: 'Colour?',
  options: [
    { label: 'Red', value: 'opt_aaaaaa' },
    { label: 'Blue', value: 'opt_bbbbbb' },
  ],
} as Question;

const withOther = { ...colour, allowOther: true } as Question;

describe('typed answers and readable values are never hidden (STU-1, CON-02, COPY-R3)', () => {
  it('Other turned off since: the reader and the CSV show what they typed, marked', () => {
    expect(formatAnswerForQuestion(colour, 'Purple with stripes')).toBe(
      'Purple with stripes (no longer an option)',
    );
    expect(formatAnswerForCsv(colour, 'Purple with stripes')).toBe(
      'Purple with stripes (no longer an option)',
    );
    // With Other on it is typed Other text, as before.
    expect(formatAnswerForQuestion(withOther, 'Purple with stripes')).toBe(
      'Other: Purple with stripes',
    );
  });

  it('a readable option deleted since (Build with AI, templates) shows its value', () => {
    const size = {
      id: 'size',
      type: 'single_choice',
      title: 'Size?',
      options: [{ label: 'Small', value: 'small' }],
    } as Question;
    expect(formatAnswerForQuestion(size, 'large')).toBe('large (no longer an option)');
    expect(formatAnswerForCsv(size, 'large')).toBe('large (no longer an option)');
  });

  it('only the studio’s own codes read “Removed option”, both kinds, with or without Other', () => {
    expect(isRemovedOptionValue('opt_19mrgr')).toBe(true);
    // The codes the studio gave options before the QA pass.
    expect(isRemovedOptionValue('opt_3')).toBe(true);
    expect(isRemovedOptionValue('opt_')).toBe(false);
    expect(isRemovedOptionValue('Option 3')).toBe(false);
    expect(formatAnswerForQuestion(colour, 'opt_cccccc')).toBe(REMOVED_OPTION);
    expect(formatAnswerForQuestion(withOther, 'opt_3')).toBe(REMOVED_OPTION);
    // A multi pick keeps each part apart.
    const multi = { ...colour, type: 'multi_choice' } as Question;
    expect(formatAnswerForQuestion(multi, ['opt_aaaaaa', 'opt_cccccc', 'Purple'])).toBe(
      'Red, Removed option, Purple (no longer an option)',
    );
  });

  it('search finds what they typed after Other was turned off', () => {
    const typed = sub({ colour: 'Purple with stripes' });
    expect(matchesSearch(typed, [colour], 'purple')).toBe(true);
    expect(matchesSearch(sub({ colour: 'opt_aaaaaa' }), [colour], 'purple')).toBe(false);
  });

  it('the Summary gives a readable value its own row, labelled as the reader shows it', () => {
    const subs = [
      sub({ colour: 'opt_aaaaaa' }),
      sub({ colour: 'Purple with stripes' }),
      sub({ colour: 'opt_dddddd' }),
    ];
    const d = questionDistribution(colour, subs);
    expect(d.rows.map((r) => [r.value, r.label, r.count])).toEqual([
      ['opt_aaaaaa', 'Red', 1],
      ['Purple with stripes', 'Purple with stripes (no longer an option)', 1],
      [REMOVED_ROW, REMOVED_OPTION, 1],
      ['opt_bbbbbb', 'Blue', 0],
    ]);
  });

  it('the CSV export carries the same words as the reader', () => {
    const csv = buildResponsesCsv([colour], [sub({ colour: 'Purple with stripes' })]);
    expect(csv).toContain('Purple with stripes (no longer an option)');
    expect(csv).not.toContain(REMOVED_OPTION);
  });
});

describe('Summary bars filter to the responses they count (STU-2)', () => {
  it('“Removed option” matches the responses holding a deleted option’s code', () => {
    const subs = [sub({ colour: 'opt_dddddd' }), sub({ colour: 'opt_aaaaaa' })];
    const d = questionDistribution(colour, subs);
    const removed = d.rows.find((r) => r.label === REMOVED_OPTION)!;
    expect(removed.value).toBe(REMOVED_ROW);
    expect(removed.count).toBe(1);
    const hits = subs.filter((s) =>
      answerMatchesFilter(s, { questionId: 'colour', value: removed.value }, colour),
    );
    expect(hits).toHaveLength(removed.count);
    expect(hits[0]!.answers.colour).toBe('opt_dddddd');
  });

  it('with Other on, the Removed and Other bars each match exactly what they count', () => {
    const multi = { ...withOther, type: 'multi_choice' } as Question;
    const subs = [
      sub({ colour: ['opt_aaaaaa', 'opt_dddddd'] }),
      sub({ colour: ['Teal'] }),
      sub({ colour: ['opt_bbbbbb'] }),
    ];
    const d = questionDistribution(multi, subs);
    for (const row of d.rows) {
      const hits = subs.filter((s) =>
        answerMatchesFilter(s, { questionId: 'colour', value: row.value }, multi),
      );
      expect([row.label, hits.length]).toEqual([row.label, row.count]);
    }
    expect(d.rows.find((r) => r.value === OTHER_VALUE)!.count).toBe(1);
    expect(d.rows.find((r) => r.value === REMOVED_ROW)!.count).toBe(1);
    expect(d.others).toEqual([{ text: 'Teal', count: 1 }]);
  });

  it('a readable value’s own row filters to it', () => {
    const subs = [sub({ colour: 'Purple' }), sub({ colour: 'opt_aaaaaa' })];
    const hits = subs.filter((s) =>
      answerMatchesFilter(s, { questionId: 'colour', value: 'Purple' }, colour),
    );
    expect(hits).toHaveLength(1);
  });
});

describe('the CSV keeps phones as stored (CON-08)', () => {
  it('“+18055550100”, as main exported, while the reader shows it as written', () => {
    const phone = { id: 'p', type: 'phone', title: 'Phone?' } as Question;
    expect(formatAnswerForCsv(phone, '+18055550100')).toBe('+18055550100');
    expect(formatAnswerForQuestion(phone, '+18055550100')).toBe('(805) 555-0100');
    const csv = buildResponsesCsv([phone], [sub({ p: '+18055550100' })]);
    expect(csv.split('\r\n')[1]).toContain(',+18055550100');
  });
});
