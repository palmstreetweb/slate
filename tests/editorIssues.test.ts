/**
 * The editor's issue list (S9, S10): plain sentences that name questions by
 * title (never an internal id, never "schema"), and only problems that would
 * stop people finishing the form hold Publish back.
 */

import { describe, expect, it } from 'vitest';
import type { Question } from '@/index.js';
import { checkSchema } from '@/index.js';
import { issuesHeading, ownerIssues, publishBlockedCopy } from '../examples/_admin/editorIssues.js';

const welcome: Question = { id: 'welcome', type: 'welcome', title: 'Hi' };
const done: Question = { id: 'done', type: 'thanks', title: 'Thanks' };
const size: Question = {
  id: 'what_size',
  type: 'single_choice',
  title: 'What size?',
  options: [
    { label: 'Small', value: 'small' },
    { label: 'Large', value: 'large' },
  ],
};

const DEV_WORDS = /schema|visibleIf|jump condition|undefined|NaN|"|\bid\b/;

function textOf(questions: Question[]): string[] {
  return ownerIssues(questions).map((i) => i.text);
}

describe('plain sentences', () => {
  it('every engine check reads as a sentence with the question title, no ids', () => {
    const questions: Question[] = [
      welcome,
      { id: 'qty', type: 'number', title: 'How many?', min: 10, max: 5 },
      { id: 'rate', type: 'scale', title: 'Rate us', min: 9, max: 1 },
      { id: 'when', type: 'date', title: 'When?', min: '2026-12-01', max: '2026-01-01' },
      {
        id: 'where_s_the_problem',
        type: 'image_pin',
        title: 'Where’s the problem?',
        required: true,
      },
      { id: 'where_s_the_job', type: 'location', title: 'Where’s the job?', radius: 25 },
      {
        id: 'reach',
        type: 'contact_info',
        title: 'Reach you?',
        fields: { name: 'off', email: 'off', phone: 'off' },
      },
      { id: 'shots', type: 'photo_checklist', title: 'Photos', items: [] },
      { id: 'free', type: 'availability', title: 'Free when?', slotMinutes: 45 },
      { id: 'pics', type: 'picture_choice', title: 'Styles', display: 'swipe', options: [] },
      { id: 'slots', type: 'signup_slots', title: 'Pick a time', slots: [] },
      { id: 'zip', type: 'address', title: 'Address', serviceArea: ['not a zip!'] },
      { id: 'a', type: 'short_text', title: 'A', prefillKey: 'src' },
      { id: 'b', type: 'short_text', title: 'B', prefillKey: 'name' },
      { id: 'c', type: 'short_text', title: 'C', prefillKey: 'name' },
      {
        id: 'hidden',
        type: 'long_text',
        title: 'Details?',
        visibleIf: { field: 'gone', op: 'equals', value: 'x' },
        logic: [
          { if: { field: 'hidden', op: 'is_not_empty' }, goTo: 'nowhere' },
          { if: { field: 'hidden', op: 'is_empty' }, goTo: 'hidden' },
        ],
      },
      size,
      done,
    ] as Question[];
    // Every engine issue kind used above is covered.
    const kinds = new Set(checkSchema(questions).map((i) => i.kind));
    expect([...kinds].sort()).toEqual([
      'bad_bounds',
      'bad_grid',
      'bad_prefill_key',
      'bad_service_area',
      'dangling_condition',
      'dangling_jump',
      'no_fields',
      'no_image',
      'no_items',
      'no_slots',
      'self_jump',
      'swipe_single',
    ]);
    const texts = textOf(questions);
    expect(texts.length).toBeGreaterThanOrEqual(kinds.size);
    for (const t of texts) {
      expect(t).toMatch(/^“[^”]+” /);
      expect(t).not.toMatch(DEV_WORDS);
      expect(t).not.toMatch(/where_s_|qty|\bhidden\b/);
    }
    expect(texts).toContain(
      '“Where’s the job?” needs your business location and a distance to check the service area.',
    );
    expect(texts).toContain(
      '“Where’s the problem?” needs a photo to mark. Upload one or paste an https link.',
    );
    expect(texts).toContain(
      '“Details?” has a “when to show” rule that uses a deleted question. Change or remove that rule.',
    );
    expect(texts).toContain(
      '“Details?” has a skip rule that goes to a deleted question. Pick where it should go.',
    );
    expect(texts).toContain(
      '“C” uses the same link name as another question. Give each one its own.',
    );
    expect(texts).toContain(
      '“A” has a link name that can’t be used. Use letters, numbers, - or _.',
    );
  });

  it('an untitled question is named by its type', () => {
    const texts = textOf([welcome, { id: 'x1', type: 'number', title: '', min: 3, max: 1 }, done]);
    expect(texts[0]).toMatch(/^“Untitled Number” /);
  });

  it('flags rules that can’t work: on itself, on a later question, a removed answer, a backward skip, unfinished', () => {
    const questions = [
      welcome,
      size,
      {
        id: 'details',
        type: 'long_text',
        title: 'Details?',
        visibleIf: { field: 'details', op: 'is_not_empty' },
      },
      {
        id: 'notes',
        type: 'long_text',
        title: 'Notes',
        visibleIf: { field: 'what_size', op: 'equals', value: 'xl' },
        logic: [{ if: { field: 'notes', op: 'is_not_empty' }, goTo: 'what_size' }],
      },
      {
        id: 'more',
        type: 'short_text',
        title: 'More?',
        visibleIf: { field: 'last', op: 'is_not_empty' },
      },
      {
        id: 'half',
        type: 'short_text',
        title: 'Half done',
        visibleIf: { field: 'what_size', op: 'equals', value: '' },
      },
      { id: 'last', type: 'short_text', title: 'Last' },
      done,
    ] as Question[];
    const issues = ownerIssues(questions);
    const byKind = (k: string) => issues.filter((i) => i.kind === k).map((i) => i.text);
    expect(byKind('rule_self')).toEqual([
      '“Details?” only shows once it’s answered, so it never shows. Change its “when to show” rule.',
    ]);
    expect(byKind('answer_removed')).toEqual([
      '“Notes” has a rule that uses an answer “What size?” no longer offers.',
    ]);
    expect(byKind('jump_back')).toEqual([
      '“Notes” skips back to “What size?”, so people could go round in circles.',
    ]);
    expect(byKind('rule_later')).toEqual([
      '“More?” waits for “Last”, which comes after it, so it may never show.',
    ]);
    expect(byKind('rule_unfinished')).toEqual([
      '“Half done” has an unfinished “when to show” rule. Finish it or remove it.',
    ]);
    // None of these stop people finishing: they never hold Publish back.
    expect(issues.every((i) => !i.blocking)).toBe(true);
  });
});

describe('what holds Publish back', () => {
  it('a number, scale or date nobody can answer, a duplicate id, and required setups with nothing to use', () => {
    const blocking = ownerIssues([
      welcome,
      { id: 'qty', type: 'number', title: 'How many?', min: 10, max: 5 },
      { id: 'pin', type: 'image_pin', title: 'Pin', required: true },
      { id: 'grid', type: 'availability', title: 'Grid', required: true, slotMinutes: 45 },
      { id: 'slots', type: 'signup_slots', title: 'Slots', slots: [] },
      { id: 'dup', type: 'short_text', title: 'One' },
      { id: 'dup', type: 'short_text', title: 'Two' },
      done,
    ] as Question[])
      .filter((i) => i.blocking)
      .map((i) => i.kind);
    expect(blocking.sort()).toEqual([
      'bad_bounds',
      'bad_grid',
      'duplicate_id',
      'no_image',
      'no_slots',
    ]);
  });

  it('the same setups on optional questions are warnings', () => {
    const issues = ownerIssues([
      welcome,
      { id: 'pin', type: 'image_pin', title: 'Pin' },
      { id: 'grid', type: 'availability', title: 'Grid', slotMinutes: 45 },
      { id: 'slots', type: 'signup_slots', title: 'Slots', slots: [], required: false },
      done,
    ] as Question[]);
    expect(issues.length).toBe(3);
    expect(issues.some((i) => i.blocking)).toBe(false);
  });

  it('lists blocking issues first', () => {
    const issues = ownerIssues([
      welcome,
      { id: 'a', type: 'short_text', title: 'A', prefillKey: 'src' },
      { id: 'qty', type: 'number', title: 'How many?', min: 10, max: 5 },
      done,
    ] as Question[]);
    expect(issues.map((i) => i.blocking)).toEqual([true, false]);
  });
});

describe('headings and the publish message', () => {
  it('counts what to fix and what to check', () => {
    const fix = { questionId: 'a', kind: 'bad_bounds', text: 'x', blocking: true } as const;
    const check = { questionId: 'b', kind: 'bad_price', text: 'y', blocking: false } as const;
    expect(issuesHeading([fix], true)).toBe('1 thing to fix before you publish');
    expect(issuesHeading([fix, fix, check], true)).toBe(
      '2 things to fix before you publish · 1 to check',
    );
    expect(issuesHeading([check, check], true)).toBe('2 things to check');
    expect(issuesHeading([fix], false)).toBe('1 thing to fix before you share');
  });

  it('shows three problems and counts the rest', () => {
    const list = Array.from({ length: 5 }, (_, i) => ({
      questionId: `q${i}`,
      kind: 'bad_bounds' as const,
      text: `Problem ${i}.`,
      blocking: true,
    }));
    expect(publishBlockedCopy(list.slice(0, 1)).title).toBe('Fix this before you publish');
    const copy = publishBlockedCopy(list);
    expect(copy.title).toBe('Fix these 5 things before you publish');
    expect(copy.lines).toEqual([
      'Problem 0.',
      'Problem 1.',
      'Problem 2.',
      'And 2 more, listed at the top of the editor.',
    ]);
  });
});
