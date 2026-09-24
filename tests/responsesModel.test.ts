import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import {
  answerMatchesFilter,
  answerQuestions,
  answerValues,
  chartableQuestions,
  dayGroupOf,
  dayGroups,
  durationParts,
  firstName,
  formatDuration,
  fullDate,
  hasFiles,
  isSafeEmail,
  kpis,
  matchesSearch,
  namedRespondent,
  questionDistribution,
  replyHref,
  respondentEmail,
  respondentName,
  responseNumbers,
  tableColumns,
  unreadIds,
} from '../examples/_admin/responses/model.js';

let seq = 0;
function sub(
  answers: Record<string, unknown>,
  receivedAt: Date | string = new Date(2026, 8, 23, 9, 0),
  durationMs = 60_000,
): StoredSubmission {
  seq += 1;
  const iso = typeof receivedAt === 'string' ? receivedAt : receivedAt.toISOString();
  return {
    id: `s${seq}`,
    formId: 'f1',
    receivedAt: iso,
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: iso,
      completedAt: iso,
      durationMs,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
  };
}

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

const pool: Question[] = [
  { id: 'company', type: 'short_text', title: 'Company or project name?' },
  { id: 'name', type: 'short_text', title: "What's your name?" },
  { id: 'email', type: 'email', title: 'Best email to reach you' },
  {
    id: 'service',
    type: 'single_choice',
    title: 'What do you need?',
    options: [
      { label: 'Quote', value: 'quote' },
      { label: 'Repair', value: 'repair' },
      { label: 'New install', value: 'new_install' },
    ],
  },
  {
    id: 'heard',
    type: 'multi_choice',
    title: 'How did you hear about us?',
    options: [
      { label: 'Google', value: 'google' },
      { label: 'A friend', value: 'friend' },
      { label: 'Flyer', value: 'flyer' },
    ],
  },
  { id: 'notes', type: 'long_text', title: 'Anything else we should know?' },
  { id: 'photo', type: 'file_upload', title: 'Photo of the pool' },
];

describe('answerQuestions', () => {
  it('drops screens that store no answer and keeps schema order', () => {
    const qs: Question[] = [
      { id: 'w', type: 'welcome', title: 'Hi' },
      { id: 'a', type: 'short_text', title: 'A' },
      { id: 's', type: 'statement', title: 'Note' },
      { id: 'b', type: 'long_text', title: 'B' },
      { id: 'r', type: 'review', title: 'Review' },
      { id: 't', type: 'thanks', title: 'Thanks' },
    ];
    expect(answerQuestions(qs).map((q) => q.id)).toEqual(['a', 'b']);
  });
});

describe('respondentName', () => {
  it('prefers a name-like short text over other short texts', () => {
    expect(respondentName(pool, { company: 'Acme', name: 'Nora Fischer' }, 3)).toBe('Nora Fischer');
  });

  it('joins first and last name questions', () => {
    const qs: Question[] = [
      { id: 'first', type: 'short_text', title: 'First name' },
      { id: 'last', type: 'short_text', title: 'Last name' },
    ];
    expect(respondentName(qs, { first: 'Nora', last: 'Fischer' }, 1)).toBe('Nora Fischer');
    expect(respondentName(qs, { first: 'Nora' }, 1)).toBe('Nora');
    expect(respondentName(qs, { last: 'Fischer' }, 1)).toBe('Fischer');
  });

  it('falls back to the first answered short text, then the email local part', () => {
    expect(respondentName(pool, { company: 'Acme Pools' }, 2)).toBe('Acme Pools');
    expect(respondentName(pool, { email: 'nora.fischer@example.com' }, 2)).toBe('nora.fischer');
  });

  it('numbers anonymous responses', () => {
    expect(respondentName(pool, { service: 'quote' }, 7)).toBe('Response #7');
    expect(respondentName(pool, { name: '   ' }, 1)).toBe('Response #1');
  });

  it('namedRespondent is null only when the response is anonymous', () => {
    expect(namedRespondent(pool, { name: 'Nora Fischer' })).toBe('Nora Fischer');
    expect(namedRespondent(pool, { email: 'nora@example.com' })).toBe('nora');
    expect(namedRespondent(pool, { service: 'quote', notes: 'Hi' })).toBeNull();
    expect(namedRespondent(pool, { email: 'not an email?cc=x@y.z' })).toBeNull();
  });

  it('collapses whitespace and clips very long names', () => {
    expect(respondentName(pool, { name: '  Nora \n  Fischer ' }, 1)).toBe('Nora Fischer');
    const long = respondentName(pool, { name: 'x'.repeat(500) }, 1);
    expect(long.length).toBe(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('keeps markup-looking names as plain text', () => {
    expect(respondentName(pool, { name: '<img src=x onerror=alert(1)>' }, 1)).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('uses the question id when the title is dynamic', () => {
    const qs = [{ id: 'name', type: 'short_text', title: () => 'Hi' }] as unknown as Question[];
    expect(respondentName(qs, { name: 'Kai' }, 1)).toBe('Kai');
  });
});

describe('emails and Reply', () => {
  it('accepts ordinary addresses', () => {
    for (const ok of [
      'nora.fischer@example.com',
      'a+tag@sub.example.co.uk',
      "o'brien@example.ie",
      'x_y-z@ex-ample.org',
    ]) {
      expect(isSafeEmail(ok), ok).toBe(true);
    }
  });

  it('refuses anything that could smuggle headers, recipients or schemes', () => {
    for (const bad of [
      'a@b.com?bcc=x@evil.com',
      'javascript:alert(1)@x.com',
      'mailto:a@b.com',
      'a@b.com&cc=x@y.com',
      'a@b.com#frag',
      'a%0Abcc:x@b.com',
      'a@b%2ecom',
      'a,b@c.com',
      'a;b@c.com',
      'a b@c.com',
      'a@b@c.com',
      'a@localhost',
      'a@-b.com',
      '@b.com',
      'a@b.c',
      '<a@b.com>',
      '"a"@b.com',
      'a@b.com/x',
      `${'a'.repeat(64)}@${'b'.repeat(190)}.com`,
      '',
    ]) {
      expect(isSafeEmail(bad), bad).toBe(false);
    }
  });

  it('picks the first answered email that passes, trimming spaces', () => {
    const qs: Question[] = [
      { id: 'e1', type: 'email', title: 'Work email' },
      { id: 'e2', type: 'email', title: 'Personal email' },
    ];
    expect(respondentEmail(qs, { e1: 'javascript:alert(1)@x.com', e2: ' ok@x.com ' })).toBe(
      'ok@x.com',
    );
    expect(respondentEmail(qs, { e1: 'a@b.com?bcc=x' })).toBeNull();
    expect(respondentEmail(qs, {})).toBeNull();
  });

  it('reads a short text titled "Email" when there is no email question', () => {
    const qs: Question[] = [{ id: 'mail', type: 'short_text', title: 'Your e-mail' }];
    expect(respondentEmail(qs, { mail: 'kai@example.com' })).toBe('kai@example.com');
  });

  it('builds a mailto link with an encoded, single-line subject', () => {
    expect(replyHref('nora@example.com', 'Pool & Spa\nSign-up?')).toBe(
      'mailto:nora@example.com?subject=Re%3A%20Pool%20%26%20Spa%20Sign-up%3F',
    );
    expect(replyHref('a@b.com?bcc=x', 'Form')).toBeNull();
    expect(replyHref(null, 'Form')).toBeNull();
  });

  it('firstName takes the first word, clipped', () => {
    expect(firstName('Nora Fischer')).toBe('Nora');
    expect(firstName('  Nora   Fischer ')).toBe('Nora');
    expect(firstName('Wolfeschlegelsteinhausenbergerdorff Sr')).toHaveLength(24);
  });
});

describe('dayGroups', () => {
  const now = at(2026, 9, 23, 10, 0); // Wednesday

  it('buckets today, yesterday, last 7 days, this month, then months', () => {
    const rows = [
      { receivedAt: at(2026, 9, 23, 0, 5).toISOString() },
      { receivedAt: at(2026, 9, 22, 23, 59).toISOString() },
      { receivedAt: at(2026, 9, 20).toISOString() },
      { receivedAt: at(2026, 9, 17).toISOString() },
      { receivedAt: at(2026, 9, 16).toISOString() },
      { receivedAt: at(2026, 9, 1).toISOString() },
      { receivedAt: at(2026, 8, 30).toISOString() },
      { receivedAt: at(2026, 8, 2).toISOString() },
      { receivedAt: at(2025, 12, 31).toISOString() },
    ];
    const groups = dayGroups(rows, now);
    const august = new Date(2026, 7, 1).toLocaleDateString(undefined, { month: 'long' });
    const dec2025 = new Date(2025, 11, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([
      ['today', 'Today', 1],
      ['yesterday', 'Yesterday', 1],
      ['week', 'Last 7 days', 2],
      ['month', 'Earlier this month', 2],
      ['m-2026-08', august, 2],
      ['m-2025-12', dec2025, 1],
    ]);
  });

  it('splits at local midnight, not 24 hours', () => {
    const justAfterMidnight = at(2026, 9, 23, 0, 10);
    expect(dayGroupOf(at(2026, 9, 22, 23, 55).toISOString(), justAfterMidnight).key).toBe(
      'yesterday',
    );
    expect(dayGroupOf(at(2026, 9, 23, 0, 1).toISOString(), justAfterMidnight).key).toBe('today');
  });

  it('keeps "Last 7 days" across a month boundary', () => {
    const oct2 = at(2026, 10, 2, 9);
    expect(dayGroupOf(at(2026, 9, 28).toISOString(), oct2).label).toBe('Last 7 days');
    expect(dayGroupOf(at(2026, 9, 20).toISOString(), oct2).key).toBe('m-2026-09');
  });

  it('adds the year across a year boundary', () => {
    const jan3 = at(2026, 1, 3, 9);
    expect(dayGroupOf(at(2025, 12, 30).toISOString(), jan3).label).toBe('Last 7 days');
    const g = dayGroupOf(at(2025, 12, 20).toISOString(), jan3);
    expect(g.key).toBe('m-2025-12');
    expect(g.label).toContain('2025');
  });

  it('treats a slightly future timestamp as today and bad input as earlier', () => {
    expect(dayGroupOf(at(2026, 9, 23, 10, 5).toISOString(), now).key).toBe('today');
    expect(dayGroupOf('not a date', now)).toEqual({ key: 'unknown', label: 'Earlier' });
  });

  it('merges rows into existing groups without reordering them', () => {
    const rows = [
      { id: 'a', receivedAt: at(2026, 9, 23, 9).toISOString() },
      { id: 'b', receivedAt: at(2026, 9, 22, 9).toISOString() },
      { id: 'c', receivedAt: at(2026, 9, 23, 8).toISOString() },
    ];
    const groups = dayGroups(rows, now);
    expect(groups.map((g) => g.items.map((r) => r.id))).toEqual([['a', 'c'], ['b']]);
  });
});

describe('dates and durations', () => {
  it('fullDate reads like "Wed, Sep 23, 9:41 AM" and adds a year outside this one', () => {
    const now = at(2026, 9, 23, 12);
    expect(fullDate(at(2026, 9, 23, 9, 41).toISOString(), now)).toMatch(/^Wed, Sep 23, 9:41\sAM$/);
    expect(fullDate(at(2025, 9, 23, 9, 41).toISOString(), now)).toMatch(
      /^Tue, Sep 23, 2025, 9:41\sAM$/,
    );
    // Never Safari's "Sep 23 at 9:41 AM": date and time are joined by a comma.
    expect(fullDate(at(2026, 9, 23, 21, 5).toISOString(), now)).not.toContain(' at ');
    expect(fullDate('nope', now)).toBe('');
  });

  it('durationParts splits hours, minutes and seconds', () => {
    expect(durationParts(79_000)).toEqual([
      { value: 1, unit: 'm' },
      { value: 19, unit: 's' },
    ]);
    expect(durationParts(45_000)).toEqual([{ value: 45, unit: 's' }]);
    expect(durationParts(120_000)).toEqual([{ value: 2, unit: 'm' }]);
    expect(durationParts(3_900_000)).toEqual([
      { value: 1, unit: 'h' },
      { value: 5, unit: 'm' },
    ]);
    expect(durationParts(400)).toEqual([{ value: 1, unit: 's' }]);
    for (const bad of [0, -5, Number.NaN, undefined, null, '79000']) {
      expect(durationParts(bad)).toBeNull();
    }
  });

  it('formatDuration joins the parts', () => {
    expect(formatDuration(79_000)).toBe('1m 19s');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('matchesSearch', () => {
  const s = sub({
    name: 'Nora Fischer',
    email: 'nora.fischer@example.com',
    service: 'new_install',
    heard: ['google', 'flyer'],
    notes: 'Heater won’t ignite.\nGate code is 4412.',
  });

  it('matches name, email, choice labels and free text, ignoring case', () => {
    for (const q of [
      'nora',
      'FISCHER',
      'example.com',
      'new install',
      'flyer',
      'gate code',
      '4412',
    ]) {
      expect(matchesSearch(s, pool, q), q).toBe(true);
    }
  });

  it('ANDs words and ignores surrounding space', () => {
    expect(matchesSearch(s, pool, '  nora   install ')).toBe(true);
    expect(matchesSearch(s, pool, 'nora repair')).toBe(false);
  });

  it('matches labels, not stored option values', () => {
    expect(matchesSearch(s, pool, 'new_install')).toBe(false);
  });

  it('empty query matches everything', () => {
    expect(matchesSearch(s, pool, '')).toBe(true);
    expect(matchesSearch(s, pool, '   ')).toBe(true);
  });

  it('re-reads labels when the questions change', () => {
    const renamed = pool.map((q) =>
      q.id === 'service' && q.type === 'single_choice'
        ? { ...q, options: q.options.map((o) => ({ ...o, label: `${o.label} (pool)` })) }
        : q,
    );
    expect(matchesSearch(s, pool, '(pool)')).toBe(false);
    expect(matchesSearch(s, renamed, '(pool)')).toBe(true);
  });
});

describe('charts', () => {
  const scale: Question = { id: 'urgency', type: 'scale', title: 'Urgency', min: 1, max: 5 };
  const nps: Question = { id: 'nps', type: 'nps', title: 'Recommend?' };
  const yesNo: Question = {
    id: 'pets',
    type: 'yes_no',
    title: 'Pets?',
    yesLabel: 'We have pets',
    noLabel: 'No pets',
  };

  it('chartableQuestions keeps choice, yes/no, scale, NPS and bounded numbers', () => {
    const qs: Question[] = [
      ...pool,
      scale,
      nps,
      yesNo,
      { id: 'legal', type: 'legal', title: 'Terms' },
      { id: 'n1', type: 'number', title: 'Rooms', min: 1, max: 6 },
      { id: 'n2', type: 'number', title: 'Budget' },
      { id: 'n3', type: 'number', title: 'Big', min: 0, max: 100 },
      { id: 'd', type: 'dropdown', title: 'State', options: [{ label: 'CA', value: 'ca' }] },
      { id: 'empty', type: 'single_choice', title: 'None', options: [] },
      {
        id: 'rank',
        type: 'ranking',
        title: 'Rank',
        options: [{ label: 'A', value: 'a' }],
      },
    ];
    expect(chartableQuestions(qs).map((q) => q.id)).toEqual([
      'service',
      'heard',
      'urgency',
      'nps',
      'pets',
      'n1',
      'd',
    ]);
  });

  it('single choice: counts, share of answered, sorted by count then option order', () => {
    const subs = [
      sub({ service: 'repair' }),
      sub({ service: 'quote' }),
      sub({ service: 'repair' }),
      sub({ service: 'retired_option' }),
      sub({}),
    ];
    const d = questionDistribution(pool[3]!, subs);
    expect(d.kind).toBe('choice');
    expect(d.answered).toBe(4);
    expect(d.max).toBe(2);
    expect(d.average).toBeNull();
    expect(d.rows).toEqual([
      { value: 'repair', label: 'Repair', count: 2, pct: 50 },
      { value: 'quote', label: 'Quote', count: 1, pct: 25 },
      { value: 'retired_option', label: 'retired_option', count: 1, pct: 25 },
      { value: 'new_install', label: 'New install', count: 0, pct: 0 },
    ]);
  });

  it('multi choice: each respondent counts once per option; shares can exceed 100%', () => {
    const subs = [
      sub({ heard: ['google', 'flyer', 'google'] }),
      sub({ heard: ['google'] }),
      sub({ heard: [] }),
    ];
    const d = questionDistribution(pool[4]!, subs);
    expect(d.answered).toBe(2);
    expect(d.rows.map((r) => [r.value, r.count, r.pct])).toEqual([
      ['google', 2, 100],
      ['flyer', 1, 50],
      ['friend', 0, 0],
    ]);
  });

  it('yes/no and legal use their labels', () => {
    const d = questionDistribution(yesNo, [
      sub({ pets: 'yes' }),
      sub({ pets: 'no' }),
      sub({ pets: 'yes' }),
    ]);
    expect(d.rows.map((r) => [r.label, r.count])).toEqual([
      ['We have pets', 2],
      ['No pets', 1],
    ]);
    const legal: Question = { id: 'terms', type: 'legal', title: 'Terms' };
    expect(questionDistribution(legal, [sub({ terms: 'accept' })]).rows[0]).toEqual({
      value: 'accept',
      label: 'Accept',
      count: 1,
      pct: 100,
    });
  });

  it('scale: one row per value in order, zeros included, plus the average', () => {
    const subs = [
      sub({ urgency: 5 }),
      sub({ urgency: 4 }),
      sub({ urgency: 4 }),
      sub({ urgency: '3' }),
    ];
    const d = questionDistribution(scale, subs);
    expect(d.kind).toBe('numeric');
    expect(d.rows.map((r) => [r.value, r.count])).toEqual([
      ['1', 0],
      ['2', 0],
      ['3', 1],
      ['4', 2],
      ['5', 1],
    ]);
    expect(d.average).toBeCloseTo(4);
    expect(d.max).toBe(2);
  });

  it('nps has eleven rows; open numbers only list values that occur, numerically', () => {
    expect(questionDistribution(nps, []).rows).toHaveLength(11);
    const budget: Question = { id: 'b', type: 'number', title: 'Budget' };
    const d = questionDistribution(budget, [sub({ b: 10 }), sub({ b: 9 }), sub({ b: 10 })]);
    expect(d.rows.map((r) => r.value)).toEqual(['9', '10']);
    expect(d.average).toBeCloseTo(29 / 3);
  });

  it('nobody answered: zeros, max 1, no average', () => {
    const d = questionDistribution(scale, [sub({}), sub({ urgency: 'n/a' })]);
    expect(d.answered).toBe(0);
    expect(d.rows.every((r) => r.count === 0 && r.pct === 0)).toBe(true);
    expect(d.max).toBe(1);
    expect(d.average).toBeNull();
  });
});

describe('kpis', () => {
  const now = at(2026, 9, 23, 10, 0); // Wednesday; week starts Mon Sep 21

  it('counts this week and last week from Monday 00:00 local time', () => {
    const subs = [
      sub({}, at(2026, 9, 23, 9, 0)),
      sub({}, at(2026, 9, 21, 0, 0)),
      sub({}, at(2026, 9, 20, 23, 59)),
      sub({}, at(2026, 9, 14, 0, 0)),
      sub({}, at(2026, 9, 13, 23, 59)),
    ];
    const k = kpis(subs, new Set(), now);
    expect(k.total).toBe(5);
    expect(k.thisWeek).toBe(2);
    expect(k.lastWeek).toBe(2);
    expect(k.weekStart).toEqual(at(2026, 9, 21, 0, 0));
  });

  it('a Sunday still belongs to the week that started on Monday', () => {
    const sunday = at(2026, 9, 27, 22);
    expect(kpis([], new Set(), sunday).weekStart).toEqual(at(2026, 9, 21, 0, 0));
    const monday = at(2026, 9, 28, 0, 30);
    expect(kpis([], new Set(), monday).weekStart).toEqual(at(2026, 9, 28, 0, 0));
  });

  it('builds a 14-day sparkline ending today', () => {
    const subs = [
      sub({}, at(2026, 9, 23, 8)),
      sub({}, at(2026, 9, 23, 1)),
      sub({}, at(2026, 9, 22, 8)),
      sub({}, at(2026, 9, 10, 8)),
      sub({}, at(2026, 9, 9, 8)),
    ];
    const k = kpis(subs, new Set(), now);
    expect(k.spark).toHaveLength(14);
    expect(k.spark[13]).toBe(2);
    expect(k.spark[12]).toBe(1);
    expect(k.spark[0]).toBe(1);
    expect(k.spark.reduce((a, b) => a + b, 0)).toBe(4);
    expect(k.sparkDays[13]).toEqual(at(2026, 9, 23, 0, 0));
    expect(k.sparkDays[0]).toEqual(at(2026, 9, 10, 0, 0));
  });

  it('median completion time ignores missing timings', () => {
    expect(
      kpis([sub({}, now, 30_000), sub({}, now, 90_000), sub({}, now, 60_000)], new Set(), now)
        .medianMs,
    ).toBe(60_000);
    expect(kpis([sub({}, now, 30_000), sub({}, now, 90_000)], new Set(), now).medianMs).toBe(
      60_000,
    );
    expect(kpis([sub({}, now, 0)], new Set(), now).medianMs).toBeNull();
  });

  it('unread counts only this form', () => {
    const a = sub({}, now);
    const b = sub({}, now);
    expect(kpis([a, b], new Set([a.id, 'other-form']), now).unread).toBe(1);
    expect(unreadIds([a, b], new Set([b.id]))).toEqual([b.id]);
  });
});

describe('table columns and row helpers', () => {
  it('two choice questions and the first long text', () => {
    const extra: Question = {
      id: 'size',
      type: 'dropdown',
      title: 'Pool size',
      options: [{ label: 'Small', value: 's' }],
    };
    const cols = tableColumns([...pool, extra]);
    expect(cols.choices.map((q) => q.id)).toEqual(['service', 'heard']);
    expect(cols.text?.id).toBe('notes');
    expect(cols.all.map((q) => q.id)).toEqual(['service', 'heard', 'notes']);
  });

  it('without long text, another text question that is not the name or email', () => {
    const qs = pool.filter((q) => q.id !== 'notes');
    expect(tableColumns(qs).text?.id).toBe('company');
    const bare: Question[] = [
      { id: 'name', type: 'short_text', title: 'Name' },
      { id: 'email', type: 'email', title: 'Email' },
      { id: 'ok', type: 'yes_no', title: 'Coming?' },
    ];
    const cols = tableColumns(bare);
    expect(cols.text).toBeNull();
    expect(cols.choices.map((q) => q.id)).toEqual(['ok']);
  });

  it('hasFiles looks at file questions only', () => {
    expect(hasFiles(sub({ photo: ['local:abc'] }), pool)).toBe(true);
    expect(hasFiles(sub({ photo: [] }), pool)).toBe(false);
    expect(hasFiles(sub({ notes: 'photo.jpg' }), pool)).toBe(false);
  });

  it('answerMatchesFilter handles single, multi and numeric answers', () => {
    expect(
      answerMatchesFilter(sub({ service: 'repair' }), { questionId: 'service', value: 'repair' }),
    ).toBe(true);
    expect(
      answerMatchesFilter(sub({ service: 'quote' }), { questionId: 'service', value: 'repair' }),
    ).toBe(false);
    expect(
      answerMatchesFilter(sub({ heard: ['flyer', 'google'] }), {
        questionId: 'heard',
        value: 'google',
      }),
    ).toBe(true);
    expect(answerMatchesFilter(sub({ urgency: 4 }), { questionId: 'urgency', value: '4' })).toBe(
      true,
    );
    expect(answerMatchesFilter(sub({}), { questionId: 'urgency', value: '4' })).toBe(false);
  });

  it('answerValues stringifies, dedupes and ignores objects', () => {
    expect(answerValues(['a', 'a', 3])).toEqual(['a', '3']);
    expect(answerValues({ row: 'col' })).toEqual([]);
    expect(answerValues('')).toEqual([]);
  });

  it('responseNumbers counts from the oldest', () => {
    const newest = sub({});
    const oldest = sub({});
    const n = responseNumbers([newest, oldest]);
    expect(n.get(oldest.id)).toBe(1);
    expect(n.get(newest.id)).toBe(2);
  });
});
