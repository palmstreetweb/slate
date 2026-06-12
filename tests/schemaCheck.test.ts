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
});
