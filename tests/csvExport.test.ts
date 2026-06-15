import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import {
  buildResponsesCsv,
  responsesCsvFilename,
  uniqueColumnTitles,
} from '../examples/_admin/csvExport.js';
import { formatAnswerForCsv } from '../examples/_admin/responsesFormat.js';

describe('csvExport', () => {
  const choice: Question = {
    id: 'service',
    type: 'single_choice',
    title: 'Which service?',
    options: [
      { label: 'Parking lot striping', value: 'striping' },
      { label: 'Driveway sealcoating', value: 'sealcoat' },
    ],
  };

  const subs: StoredSubmission[] = [
    {
      id: 's1',
      formId: 'f1',
      receivedAt: '2026-06-14T18:00:00.000Z',
      answers: { service: 'striping', name: 'Alex' },
      meta: {
        startedAt: '2026-06-14T17:59:00.000Z',
        completedAt: '2026-06-14T18:00:00.000Z',
        durationMs: 90_000,
        questionsVisited: ['service'],
        hiddenFields: [],
        score: 2,
      },
    },
  ];

  it('uniqueColumnTitles disambiguates duplicate headers', () => {
    expect(uniqueColumnTitles(['Pick one', 'Pick one', 'Email'])).toEqual([
      'Pick one',
      'Pick one (2)',
      'Email',
    ]);
  });

  it('buildResponsesCsv uses human labels and formatted meta', () => {
    const questions: Question[] = [
      choice,
      { id: 'name', type: 'short_text', title: "What's your first name?" },
    ];
    const csv = buildResponsesCsv(questions, subs);
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe('Submitted,Time spent,Score,Which service?,What\'s your first name?');
    expect(lines[1]).toMatch(/Parking lot striping/);
    expect(lines[1]).toContain('1 min 30 sec');
    expect(lines[1]).not.toMatch(/,striping,/);
    expect(lines[1]).not.toContain('90000');
    expect(lines[1]).not.toContain('2026-06-14T18:00:00.000Z');
  });

  it('formatAnswerForCsv flattens multiline answers', () => {
    const ranking: Question = {
      id: 'rank',
      type: 'ranking',
      title: 'Rank',
      options: [
        { label: 'First', value: 'one' },
        { label: 'Second', value: 'two' },
      ],
    };
    const text = formatAnswerForCsv(ranking, ['one', 'two']);
    expect(text).toBe('1. First; 2. Second');
    expect(text).not.toContain('\n');
  });

  it('responsesCsvFilename includes form name and date', () => {
    expect(responsesCsvFilename('805 Quote')).toMatch(/^805 Quote — responses \d{4}-\d{2}-\d{2}\.csv$/);
  });
});
