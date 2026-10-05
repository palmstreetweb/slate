/** Schema sanity checker (roadmap Phase 6, ADR-018). */

import { describe, it, expect } from 'vitest';
import { checkSchema } from '@/logic/schemaCheck.js';
import type { Question } from '@/types/Question.js';

const clean: Question[] = [
  { id: 'welcome', type: 'welcome', title: 'hi' },
  {
    id: 'interested',
    type: 'yes_no',
    title: 'Interested?',
    logic: [{ if: { field: 'interested', op: 'equals', value: 'no' }, goTo: 'done' }],
  },
  {
    id: 'email',
    type: 'email',
    title: 'Email?',
    visibleIf: { field: 'interested', op: 'equals', value: 'yes' },
  },
  { id: 'done', type: 'thanks', title: 'bye' },
];

describe('checkSchema', () => {
  it('clean schema → no issues', () => {
    expect(checkSchema(clean)).toEqual([]);
  });

  it('flags duplicate ids once', () => {
    const qs: Question[] = [
      { id: 'a', type: 'short_text', title: 'x' },
      { id: 'a', type: 'short_text', title: 'y' },
      { id: 'a', type: 'short_text', title: 'z' },
    ];
    const issues = checkSchema(qs);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('duplicate_id');
  });

  it('flags visibleIf referencing an unknown question, including nested composites', () => {
    const qs: Question[] = [
      { id: 'a', type: 'short_text', title: 'x' },
      {
        id: 'b',
        type: 'short_text',
        title: 'y',
        visibleIf: {
          all: [
            { field: 'a', op: 'is_not_empty' },
            { any: [{ field: 'ghost', op: 'equals', value: 1 }] },
          ],
        },
      },
    ];
    const issues = checkSchema(qs);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ questionId: 'b', kind: 'dangling_condition' });
    // Owners never see internal ids (QA 2026-10): the message names the question by its title.
    expect(issues[0]!.message).toBe(
      '“y” has a “When to show” rule that uses a deleted question. Change or remove it.',
    );
  });

  it('flags dangling and self jump targets', () => {
    const qs: Question[] = [
      {
        id: 'a',
        type: 'yes_no',
        title: 'x',
        logic: [
          { if: { field: 'a', op: 'equals', value: 'yes' }, goTo: 'nowhere' },
          { if: { field: 'a', op: 'equals', value: 'no' }, goTo: 'a' },
        ],
      },
    ];
    const kinds = checkSchema(qs).map((i) => i.kind);
    expect(kinds).toContain('dangling_jump');
    expect(kinds).toContain('self_jump');
  });

  it('flags jump conditions referencing unknown questions', () => {
    const qs: Question[] = [
      { id: 'a', type: 'short_text', title: 'x' },
      {
        id: 'b',
        type: 'short_text',
        title: 'y',
        logic: [{ if: { field: 'ghost', op: 'is_empty' }, goTo: 'a' }],
      },
    ];
    const issues = checkSchema(qs);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('dangling_condition');
  });

  it('flags an Other condition on a question without Other (ADR-063)', () => {
    const qs: Question[] = [
      { id: 'a', type: 'single_choice', title: 'x', options: [{ label: 'A', value: 'a' }] },
      {
        id: 'b',
        type: 'short_text',
        title: 'y',
        visibleIf: { field: 'a', op: 'equals', value: '__other__' },
      },
    ];
    expect(checkSchema(qs).map((i) => i.kind)).toEqual(['other_off']);
    const withOther = [{ ...qs[0]!, allowOther: true } as Question, qs[1]!];
    expect(checkSchema(withOther)).toEqual([]);
  });

  it('flags reserved, malformed and duplicate prefill keys (ADR-063)', () => {
    const qs: Question[] = [
      { id: 'a', type: 'short_text', title: 'x', prefillKey: 'name' },
      { id: 'b', type: 'email', title: 'y', prefillKey: 'NAME' },
      { id: 'c', type: 'short_text', title: 'z', prefillKey: 'src' },
      { id: 'd', type: 'short_text', title: 'w', prefillKey: 'first name' },
      { id: 'e', type: 'short_text', title: 'v', prefillKey: 'ok_key' },
    ];
    const issues = checkSchema(qs);
    expect(issues.map((i) => [i.questionId, i.kind])).toEqual([
      ['b', 'bad_prefill_key'],
      ['c', 'bad_prefill_key'],
      ['d', 'bad_prefill_key'],
    ]);
  });

  it('flags a minimum above the maximum', () => {
    const qs: Question[] = [
      { id: 'n', type: 'number', title: 'x', min: 10, max: 2 },
      { id: 'd', type: 'date', title: 'y', min: '2026-12-01', max: '2026-01-01' },
      { id: 's', type: 'scale', title: 'z', min: 1, max: 5 },
    ];
    expect(checkSchema(qs).map((i) => [i.questionId, i.kind])).toEqual([
      ['n', 'bad_bounds'],
      ['d', 'bad_bounds'],
    ]);
  });
});

/**
 * QA 2026-10 (CH-17, F25, MEDIA-13, COPY-06): the editor shows these messages to
 * the form's owner. Every one names the question by its title, says what to do,
 * and never shows an internal id, the word "schema" or a developer term.
 */
describe('checkSchema messages are for owners', () => {
  const OUT = '__out_of_area__';
  const broken: Question[] = [
    { id: 'dup_one', type: 'short_text', title: 'Your name?' },
    { id: 'dup_one', type: 'short_text', title: 'Your name again?' },
    {
      id: 'pick_one',
      type: 'single_choice',
      title: 'Pick a package',
      options: [{ label: 'Basic', value: 'opt_1', price: 500, priceMax: 100 }],
    },
    { id: 'windows', type: 'number', title: 'How many windows?', min: 10, max: 2, unitPrice: Number.NaN },
    { id: 'addr', type: 'address', title: 'What’s the address?', serviceArea: ['abc!'] },
    { id: 'pin', type: 'image_pin', title: 'Where’s the problem? Tap the photo.' },
    { id: 'shots', type: 'photo_checklist', title: 'Snap a few photos', items: [] },
    { id: 'free', type: 'availability', title: 'When are you free?', startTime: '17:00', endTime: '09:00' },
    { id: 'job', type: 'location', title: 'Where’s the job?', center: { lat: 34.4, lng: -119.7 } },
    { id: 'cards', type: 'picture_choice', title: 'Which look?', options: [], display: 'swipe' },
    { id: 'slots', type: 'signup_slots', title: 'Pick a time', slots: [] },
    {
      id: 'slots2',
      type: 'signup_slots',
      title: 'Bring something',
      slots: [{ label: '', value: 's_1', capacity: 2 }],
    },
    { id: 'reach', type: 'contact_info', title: 'How can we reach you?', fields: { name: 'off', email: 'off', phone: 'off' } },
    { id: 'first', type: 'short_text', title: 'First name?', prefillKey: 'src' },
    { id: 'first_a', type: 'short_text', title: 'First name (again)?', prefillKey: 'first' },
    { id: 'first_b', type: 'email', title: 'Email?', prefillKey: 'FIRST' },
    {
      id: 'details',
      type: 'long_text',
      title: 'Tell us more',
      visibleIf: { field: 'gone_question', op: 'is_not_empty' },
      logic: [
        { if: { field: 'pick_one', op: 'equals', value: '__other__' }, goTo: 'nowhere_id' },
        { if: { field: 'addr', op: 'equals', value: OUT }, goTo: 'details' },
      ],
    },
  ];

  const issues = checkSchema(broken);

  it('covers every kind of problem', () => {
    expect(new Set(issues.map((i) => i.kind))).toEqual(
      new Set([
        'duplicate_id',
        'bad_price',
        'bad_bounds',
        'bad_service_area',
        'no_image',
        'no_items',
        'bad_grid',
        'swipe_single',
        'no_slots',
        'bad_slots',
        'no_fields',
        'bad_prefill_key',
        'dangling_condition',
        'other_off',
        'area_off',
        'dangling_jump',
        'self_jump',
      ]),
    );
  });

  it('names the question by its title and never shows ids or developer words', () => {
    for (const issue of issues) {
      const titles = broken
        .filter((x) => x.id === issue.questionId)
        .map((x) => `“${(x as { title: string }).title}”`);
      expect(titles.some((t) => issue.message.startsWith(t))).toBe(true);
      expect(issue.message).toMatch(/\.$/);
      // Internal ids are snake_case slugs ("dup_one", "gone_question"); the old copy quoted them.
      expect(issue.message).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(issue.message).not.toContain('"');
      expect(issue.message).not.toMatch(
        /schema|visibleIf|undefined|NaN|latitude|\bid\b|\bISO\b|payload|JSON/i,
      );
    }
  });

  it('reads plainly, case by case', () => {
    const say = (id: string, kind: string) =>
      issues.filter((i) => i.questionId === id && i.kind === kind).map((i) => i.message);
    expect(say('windows', 'bad_bounds')).toEqual([
      '“How many windows?” has a minimum above its maximum, so nobody can answer it.',
    ]);
    expect(say('pick_one', 'bad_price')).toEqual(['“Pick a package”: fix the price on “Basic”.']);
    expect(say('job', 'bad_service_area')).toEqual([
      '“Where’s the job?” needs both your business location and a radius.',
    ]);
    expect(say('first_b', 'bad_prefill_key')).toEqual([
      '“Email?” and “First name (again)?” use the same link name, “FIRST”. Rename one.',
    ]);
    expect(say('details', 'self_jump')).toEqual([
      '“Tell us more” skips to itself. Pick a new place to skip to.',
    ]);
    expect(say('details', 'other_off')).toEqual([
      '“Tell us more” has a rule about “Other” on “Pick a package”, but that choice is off.',
    ]);
  });

  it('shortens long titles and copes with an untitled question', () => {
    const long = 'Tap the spots on the house where you see damage, and add a note for each one';
    const [pin] = checkSchema([{ id: 'p', type: 'image_pin', title: long }]);
    expect(pin!.message).toBe(
      '“Tap the spots on the house where you see…” needs a photo to mark. Upload one or paste an https link.',
    );
    const [blank] = checkSchema([{ id: 'n', type: 'number', title: '  ', min: 3, max: 1 }]);
    expect(blank!.message).toBe(
      'A question with no title has a minimum above its maximum, so nobody can answer it.',
    );
  });
});
