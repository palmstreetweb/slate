/**
 * Studio-side pure helpers for ADR-063: tracked links + prefill from the
 * link, close settings, the store/row mapping of 019's columns, the public
 * lookup's closed payload, and the Responses model (Other grouping, sources).
 */

import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import { OTHER_VALUE } from '@/index.js';
import {
  TRACKING_PARAMS,
  addTrackedSource,
  prefillFromSearch,
  sourceLabel,
  sourceOf,
  sourceSlug,
  trackedLinkUrl,
  trackingFromSearch,
} from '../examples/_admin/trackedLinks.js';
import {
  closedReason,
  describeClose,
  hasCloseSettings,
  isoToLocalInput,
  localInputToIso,
} from '../examples/_admin/formClose.js';
import {
  cleanTrackedSources,
  closedInfoOf,
  formRecordToRow,
  rowToFormRecord,
  slugRowToPublishedForm,
} from '../examples/_admin/neon/mappers.js';
import type { FormRecord } from '../examples/_admin/_formsStore.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import {
  DIRECT_SOURCE,
  SOURCE_FILTER_ID,
  answerMatchesFilter,
  hasSources,
  questionDistribution,
  sourceDistribution,
  subSource,
  tableColumns,
} from '../examples/_admin/responses/model.js';
import { formatAnswerForQuestion } from '../examples/_admin/responsesFormat.js';
import { buildBackup, parseBackup, serializeBackup } from '../examples/_admin/dataBackup.js';

const sub = (
  id: string,
  answers: Record<string, unknown>,
  hiddenFields: Record<string, unknown> = {},
): StoredSubmission => ({
  id,
  formId: 'f',
  receivedAt: '2026-09-29T18:00:00.000Z',
  answers: answers as StoredSubmission['answers'],
  meta: {
    startedAt: '',
    completedAt: '',
    durationMs: 1000,
    questionsVisited: [],
    hiddenFields,
    score: 0,
  },
});

describe('tracked links and prefill from the link', () => {
  it('reads src and utm_* into hidden fields, trimmed, capped, printable', () => {
    const params = new URLSearchParams(
      `src=${encodeURIComponent('  mailbox-flyer \u0007')}&utm_campaign=fall&name=Jane&utm_source=${'x'.repeat(300)}`,
    );
    const out = trackingFromSearch(params);
    expect(out).toEqual({
      src: 'mailbox-flyer',
      utm_campaign: 'fall',
      utm_source: 'x'.repeat(100),
    });
    expect(Object.keys(out).every((k) => (TRACKING_PARAMS as readonly string[]).includes(k))).toBe(
      true,
    );
  });

  it('prefill gets every other well-formed parameter, bounded', () => {
    const params = new URLSearchParams('src=a&embed=1&name=Jane&bad key=1&email=&UTM_SOURCE=x');
    expect(prefillFromSearch(params)).toEqual({ name: 'Jane' });
    const many = new URLSearchParams(Array.from({ length: 50 }, (_, i) => `k${i}=${i}`).join('&'));
    expect(Object.keys(prefillFromSearch(many))).toHaveLength(30);
  });

  it('builds slugs and links without touching the base link', () => {
    expect(sourceSlug('Mailbox flyer — Oak St.')).toBe('mailbox-flyer-oak-st');
    expect(sourceSlug('Café Menu!!')).toBe('cafe-menu');
    expect(sourceSlug('   ')).toBe('');
    const base = 'https://slateforms.vercel.app/forms/48210377';
    expect(trackedLinkUrl(base, 'door-hanger')).toBe(`${base}?src=door-hanger`);
    expect(base).toBe('https://slateforms.vercel.app/forms/48210377');
  });

  it('names sources: the owner name, a prettified slug, or Direct', () => {
    const tracked = [{ name: 'Mailbox flyer — Oak St', src: 'mailbox-flyer', createdAt: '' }];
    expect(sourceOf({ src: 'mailbox-flyer' })).toBe('mailbox-flyer');
    expect(sourceOf({ utm_source: 'facebook' })).toBe('facebook');
    expect(sourceOf({})).toBeNull();
    expect(sourceLabel('mailbox-flyer', tracked)).toBe('Mailbox flyer — Oak St');
    expect(sourceLabel('door_hanger')).toBe('Door hanger');
    expect(sourceLabel(null)).toBe('Direct');
  });

  it('addTrackedSource dedupes by slug, refuses blanks, caps at 50', () => {
    const a = addTrackedSource([], 'Mailbox flyer');
    if ('error' in a) throw new Error(a.error);
    expect(a.entry).toMatchObject({ name: 'Mailbox flyer', src: 'mailbox-flyer' });
    const again = addTrackedSource(a.list, 'MAILBOX FLYER');
    expect('error' in again ? null : again.list).toHaveLength(1);
    expect(addTrackedSource([], '  ')).toEqual({ error: expect.any(String) });
    expect(addTrackedSource([], '!!!')).toEqual({ error: expect.any(String) });
    const full = Array.from({ length: 50 }, (_, i) => ({
      name: `n${i}`,
      src: `n${i}`,
      createdAt: '',
    }));
    expect(addTrackedSource(full, 'one more')).toEqual({ error: expect.any(String) });
  });
});

describe('close settings', () => {
  const now = Date.parse('2026-09-29T20:00:00Z');

  it('closedReason: date, then cap, else open', () => {
    expect(closedReason({ closesAt: '2026-09-29T19:59:00Z' }, 0, now)).toBe('date');
    expect(closedReason({ closesAt: '2026-09-29T21:00:00Z' }, 0, now)).toBeNull();
    expect(closedReason({ maxResponses: 20 }, 20, now)).toBe('full');
    expect(closedReason({ maxResponses: 20 }, 19, now)).toBeNull();
    expect(closedReason({}, 999, now)).toBeNull();
    expect(closedReason(null, 0, now)).toBeNull();
    expect(hasCloseSettings({})).toBe(false);
    expect(hasCloseSettings({ maxResponses: 5 })).toBe(true);
  });

  it('describeClose reads in one line', () => {
    const at = new Date(now);
    expect(describeClose({}, 3, at)).toBe('Open');
    expect(describeClose({ maxResponses: 20 }, 12, at)).toBe('Open · 12 of 20 responses');
    expect(describeClose({ maxResponses: 20 }, 20, at)).toBe('Closed · 20 of 20 responses');
    expect(describeClose({ closesAt: '2026-09-29T19:00:00Z' }, 0, at)).toMatch(/^Closed /);
    expect(describeClose({ closesAt: '2026-10-05T01:00:00Z' }, 0, at)).toMatch(/^Open · closes /);
  });

  it('datetime-local round trip', () => {
    const iso = localInputToIso('2026-10-05T18:30')!;
    expect(isoToLocalInput(iso)).toBe('2026-10-05T18:30');
    expect(localInputToIso('tomorrow')).toBeUndefined();
    expect(isoToLocalInput(undefined)).toBe('');
  });
});

describe('019 columns in the store mapping', () => {
  const base = {
    id: 'f_1',
    name: 'Pool party',
    slug: '48210377',
    schema: { brand: { name: 'x' }, theme: 'classic', themeMode: 'light', questions: [] },
    published_schema: null,
    status: 'draft' as const,
    owner_id: 'u',
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    deleted_at: null,
  };

  it('reads close settings and cleans tracked sources', () => {
    const rec = rowToFormRecord({
      ...base,
      closes_at: '2026-10-05T01:00:00Z',
      max_responses: 20,
      closed_message: 'Full!',
      tracked_sources: [
        { name: 'Mailbox flyer', src: 'mailbox-flyer', createdAt: 'x' },
        { name: 'Bad', src: 'Not A Slug' },
        'junk',
      ] as never,
    } as never);
    expect(rec).toMatchObject({
      closesAt: '2026-10-05T01:00:00Z',
      maxResponses: 20,
      closedMessage: 'Full!',
      trackedSources: [{ name: 'Mailbox flyer', src: 'mailbox-flyer', createdAt: 'x' }],
    });
    expect(cleanTrackedSources(null)).toEqual([]);
  });

  it('writes them only when the database has the columns; undefined clears', () => {
    const rec: FormRecord = {
      id: 'f_1',
      name: 'Pool party',
      slug: '48210377',
      createdAt: '',
      updatedAt: '',
      schema: base.schema as never,
      maxResponses: 20,
      trackedSources: [{ name: 'A', src: 'a', createdAt: '' }],
    };
    expect(formRecordToRow(rec)).not.toHaveProperty('max_responses');
    expect(formRecordToRow(rec, { closeColumns: true })).toMatchObject({
      closes_at: null,
      max_responses: 20,
      closed_message: null,
      tracked_sources: [{ name: 'A', src: 'a', createdAt: '' }],
    });
  });

  it('a backup round-trips the new fields', () => {
    const rec = rowToFormRecord({ ...base, max_responses: 5, closed_message: 'Bye' } as never);
    const back = parseBackup(serializeBackup(buildBackup([rec], [])))!;
    expect(back.forms[0]).toMatchObject({ maxResponses: 5, closedMessage: 'Bye' });
  });
});

describe('public lookup: closed payload', () => {
  const row = { id: 'f_1', name: 'Pool party', slug: '48210377' };

  it('closed wins over locked and never carries a schema', () => {
    expect(
      slugRowToPublishedForm({
        ...row,
        locked: true,
        schema: null,
        closed: { reason: 'full', message: 'All spots taken' },
      }),
    ).toEqual({
      ...row,
      locked: true,
      schema: null,
      closed: { reason: 'full', message: 'All spots taken' },
    });
    expect(slugRowToPublishedForm({ ...row, locked: false, schema: { questions: [] } })).toEqual({
      ...row,
      locked: false,
      schema: { questions: [] },
    });
  });

  it('closedInfoOf refuses anything but date / full', () => {
    expect(closedInfoOf({ reason: 'date', message: '' })).toEqual({
      reason: 'date',
      message: null,
    });
    expect(closedInfoOf({ reason: 'weather' })).toBeNull();
    expect(closedInfoOf('closed')).toBeNull();
  });
});

describe('responses model: Other and sources', () => {
  const how: Question = {
    id: 'how',
    type: 'single_choice',
    title: 'How did you hear?',
    allowOther: true,
    otherLabel: 'Somewhere else',
    options: [
      { label: 'Flyer', value: 'flyer' },
      { label: 'Google', value: 'google' },
    ],
  };
  const subs = [
    sub('a', { how: 'flyer' }, { src: 'mailbox-flyer' }),
    sub('b', { how: 'Yard sign' }, { src: 'mailbox-flyer' }),
    sub('c', { how: 'yard sign ' }),
    sub('d', { how: 'Neighbor' }, { utm_source: 'facebook' }),
  ];

  it('groups typed answers in one Other row and lists what was typed', () => {
    const d = questionDistribution(how, subs);
    const other = d.rows.find((r) => r.value === OTHER_VALUE)!;
    expect(other).toMatchObject({ label: 'Somewhere else', count: 3 });
    expect(d.rows.find((r) => r.value === 'flyer')!.count).toBe(1);
    expect(d.rows.some((r) => r.value === 'Yard sign')).toBe(false);
    expect(d.others).toEqual([
      { text: 'Yard sign', count: 2 },
      { text: 'Neighbor', count: 1 },
    ]);
  });

  it('the Other filter matches typed answers only', () => {
    const f = { questionId: 'how', value: OTHER_VALUE };
    expect(subs.filter((s) => answerMatchesFilter(s, f, how)).map((s) => s.id)).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('formats a typed answer with the Other label', () => {
    expect(formatAnswerForQuestion(how, 'Yard sign')).toBe('Somewhere else: Yard sign');
    expect(formatAnswerForQuestion(how, 'google')).toBe('Google');
  });

  it('counts responses per source, keeps tracked links at 0, Direct last', () => {
    expect(hasSources(subs)).toBe(true);
    expect(hasSources([sub('z', {})])).toBe(false);
    expect(subSource(subs[2]!)).toBe(DIRECT_SOURCE);
    const d = sourceDistribution(subs, [
      { name: 'Mailbox flyer', src: 'mailbox-flyer', createdAt: '' },
      { name: 'Door hanger', src: 'door-hanger', createdAt: '' },
    ]);
    expect(d.rows.map((r) => [r.label, r.count])).toEqual([
      ['Mailbox flyer', 2],
      ['Facebook', 1],
      ['Direct', 1],
      ['Door hanger', 0],
    ]);
    const bySource = { questionId: SOURCE_FILTER_ID, value: 'mailbox-flyer' };
    expect(subs.filter((s) => answerMatchesFilter(s, bySource)).map((s) => s.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('a Source column takes the second choice column', () => {
    const qs: Question[] = [
      how,
      { id: 'yn', type: 'yes_no', title: 'Ok?' },
      { id: 'note', type: 'long_text', title: 'Note' },
    ];
    expect(tableColumns(qs).choices.map((q) => q.id)).toEqual(['how', 'yn']);
    const withSource = tableColumns(qs, { source: true });
    expect(withSource.choices.map((q) => q.id)).toEqual(['how']);
    expect(withSource.source).toBe(true);
  });
});
