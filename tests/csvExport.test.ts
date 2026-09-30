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

    // ADR-063 added a Source column after Score ("Direct" without a tracked link).
    expect(lines[0]).toBe(
      "Submitted,Time spent,Score,Source,Which service?,What's your first name?",
    );
    expect(lines[1]).toContain(',Direct,');
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

  it('buildResponsesCsv includes answers for removed question ids', () => {
    const questions: Question[] = [choice];
    const csv = buildResponsesCsv(questions, subs);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('(removed) name');
    expect(lines[1]).toContain('Alex');
  });

  it('responsesCsvFilename includes form name and date', () => {
    expect(responsesCsvFilename('805 Quote')).toMatch(
      /^805 Quote — responses \d{4}-\d{2}-\d{2}\.csv$/,
    );
  });
});

describe('CSV formula injection (ADR-046)', () => {
  const csv = (value: string) =>
    buildResponsesCsv(
      [{ id: 'q', type: 'short_text', title: 'Q' }] as Question[],
      [
        {
          id: 's1',
          formId: 'f',
          receivedAt: '2026-09-22T00:00:00.000Z',
          answers: { q: value },
          meta: {
            startedAt: '',
            completedAt: '',
            durationMs: 0,
            questionsVisited: [],
            hiddenFields: {},
          },
        },
      ] as StoredSubmission[],
    );

  it('defuses cells that a spreadsheet would execute', () => {
    for (const bad of ['=HYPERLINK("https://evil")', '+cmd', '@SUM(1)', '-2+3', '\tx']) {
      expect(csv(bad)).toContain(`'${bad.replace(/"/g, '""')}`);
    }
  });

  it('leaves plain negative numbers and normal text alone', () => {
    expect(csv('-42.5')).toContain('-42.5');
    expect(csv('-42.5')).not.toContain("'-42.5");
    expect(csv('hello')).not.toContain("'hello");
  });

  it('Source names tracked links, and Other / dates / units read plainly (ADR-063)', () => {
    const questions: Question[] = [
      {
        id: 'how',
        type: 'single_choice',
        title: 'How did you hear?',
        allowOther: true,
        options: [{ label: 'Flyer', value: 'flyer' }],
      },
      { id: 'stay', type: 'date', title: 'Dates', range: true },
      { id: 'sqft', type: 'number', title: 'Size', unit: 'sq ft' },
    ];
    const rows: StoredSubmission[] = [
      {
        id: 's_a',
        formId: 'f',
        receivedAt: '2026-09-29T18:00:00.000Z',
        answers: { how: 'Yard sign', stay: '2026-10-03/2026-10-07', sqft: 1800 },
        meta: {
          startedAt: '',
          completedAt: '',
          durationMs: 1000,
          questionsVisited: [],
          hiddenFields: { src: 'mailbox-flyer' },
          score: 0,
        },
      },
      {
        id: 's_b',
        formId: 'f',
        receivedAt: '2026-09-29T19:00:00.000Z',
        answers: { how: 'flyer' },
        meta: {
          startedAt: '',
          completedAt: '',
          durationMs: 1000,
          questionsVisited: [],
          hiddenFields: { src: 'door-hanger' },
          score: 0,
        },
      },
    ];
    const lines = buildResponsesCsv(questions, rows, [
      { name: 'Mailbox flyer — Oak St', src: 'mailbox-flyer', createdAt: '' },
    ]).split('\r\n');
    expect(lines[1]).toContain(',Mailbox flyer — Oak St,');
    expect(lines[1]).toContain(',Other: Yard sign,');
    expect(lines[1]).toContain('10/03/2026 – 10/07/2026');
    // Numbers stay numbers for the spreadsheet.
    expect(lines[1]!.endsWith(',1800')).toBe(true);
    expect(lines[2]).toContain(',Door hanger,Flyer,');
  });
});
