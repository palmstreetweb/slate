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
    expect(issues[0]!.message).toContain('ghost');
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
