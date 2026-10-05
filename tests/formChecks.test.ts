/**
 * Studio-side form checks (QA 2026-10: CH-04, CH-05, S3, S5, S6, S13, S14, S16,
 * S17, F3, F7, F9, F13, F20, MEDIA-05, MEDIA-20, GAP-09). Settings that would trap
 * respondents are blocking; the rest are heads-ups. Every message is the owner's
 * words: the question's title, what's wrong, what to do.
 */

import { describe, expect, it } from 'vitest';
import { getCountries } from 'libphonenumber-js';
import type { Question, SignupSlot } from '@/index.js';
import {
  formIssues,
  newOptionLabel,
  newOptionValue,
  normalizeRedirectUrl,
  pickProblem,
  scalePointCount,
  slotProblems,
  studioIssues,
  withUniqueValues,
  type FormIssue,
} from '../examples/_admin/formChecks.js';
import {
  PHONE_COUNTRIES,
  isPhoneCountry,
  phoneCountryOptions,
} from '../examples/_admin/phoneCountries.js';
import { ownerIssues } from '../examples/_admin/editorIssues.js';

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `Choice ${i + 1}`, value: `opt_${i + 1}` }));

const multi = (extra: Record<string, unknown>): Question =>
  ({
    id: 'services',
    type: 'multi_choice',
    title: 'Which services?',
    options: opts(4),
    ...extra,
  }) as Question;

const kinds = (qs: Question[]) => studioIssues(qs, '2026-10-04').map((i) => [i.kind, i.blocking]);

/** Owner words only: no snake_case ids, no developer terms, a full sentence. */
function expectPlain(issue: FormIssue) {
  expect(issue.message).toMatch(/\.$/);
  expect(issue.message).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  expect(issue.message).not.toMatch(/schema|undefined|NaN|\bid\b|ISO|payload|JSON|localStorage/i);
}

describe('multi-select pick limits', () => {
  it('a reachable Min / Max is fine', () => {
    expect(pickProblem(multi({ min: 1, max: 3 }) as never)).toBeNull();
    expect(kinds([multi({ min: 2, max: 4 })])).toEqual([]);
  });

  it('Min above the number of choices traps respondents — counting “Other”', () => {
    const [issue] = studioIssues([multi({ min: 6 })]);
    expect(issue).toMatchObject({ kind: 'pick_range', blocking: true });
    expect(issue!.message).toBe(
      '“Which services?” asks for at least 6 picks but has only 4 choices.',
    );
    expect(kinds([multi({ min: 5, allowOther: true })])).toEqual([]);
    const [withOther] = studioIssues([multi({ min: 6, allowOther: true })]);
    expect(withOther!.message).toBe(
      '“Which services?” asks for at least 6 picks but has only 5 choices (counting “Other”).',
    );
  });

  it('Max below Min traps respondents', () => {
    const [issue] = studioIssues([multi({ min: 3, max: 2 })]);
    expect(issue).toMatchObject({ kind: 'pick_range', blocking: true });
    expect(issue!.message).toBe(
      '“Which services?” asks for at least 3 picks but allows at most 2.',
    );
  });

  it('Max of 0, -1 or 2.5 and Min of 1.5 are refused; a negative Min is only a heads-up', () => {
    for (const max of [0, -1, 2.5]) {
      expect(kinds([multi({ max })])).toEqual([['pick_limits', true]]);
    }
    expect(kinds([multi({ min: 1.5 })])).toEqual([['pick_limits', true]]);
    expect(kinds([multi({ min: -3 })])).toEqual([['pick_limits', false]]);
    expect(kinds([multi({ min: 99999999999 })])).toEqual([['pick_range', true]]);
  });

  it('Max above the choices never blocks', () => {
    const [issue] = studioIssues([multi({ max: 6 })]);
    expect(issue).toMatchObject({ kind: 'pick_max_high', blocking: false });
    expect(issue!.message).toBe('“Which services?” allows up to 6 picks but has only 4 choices.');
  });

  it('picture choice: only when multiple, and swipe cards talk about likes and cards', () => {
    const pic = {
      id: 'looks',
      type: 'picture_choice',
      title: 'Which looks?',
      options: opts(2).map((o) => ({ ...o, src: 'https://x.test/a.jpg' })),
      min: 5,
    };
    expect(kinds([pic as Question])).toEqual([]);
    const [grid] = studioIssues([{ ...pic, multiple: true } as Question]);
    expect(grid!.message).toBe('“Which looks?” asks for at least 5 picks but has only 2 choices.');
    const [swipe] = studioIssues([
      { ...pic, multiple: true, display: 'swipe', allowOther: true } as Question,
    ]);
    expect(swipe!.message).toBe('“Which looks?” asks for at least 5 likes but has only 2 cards.');
  });
});

describe('options', () => {
  it('a new value is never one in the list (so a delete-then-add never ticks two rows)', () => {
    const list = [{ value: 'opt_1' }, { value: 'opt_2' }, { value: 'opt_4' }];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const v = newOptionValue(list);
      expect(v).toMatch(/^opt_[a-z0-9]{6}$/);
      expect(list.some((o) => o.value === v)).toBe(false);
      seen.add(v);
    }
    // Random, not counted from the length: a removed option's value doesn't come back.
    expect(seen.size).toBeGreaterThan(190);
  });

  it('a new label is the next letter nobody uses', () => {
    expect(newOptionLabel([{ label: 'Option A' }, { label: 'Option B' }])).toBe('Option C');
    // Delete A from [A, B, C] then add: not a second "Option C".
    expect(newOptionLabel([{ label: 'Option B' }, { label: 'Option C' }])).toBe('Option D');
    expect(newOptionLabel(Array.from({ length: 26 }, (_, i) => ({ label: `x${i}` })))).toBe(
      'Option AA',
    );
  });

  it('repeats get fresh values; labels, prices and the first copy stay', () => {
    const fixed = withUniqueValues([
      { label: 'A', value: 'opt_1' },
      { label: 'D', value: 'opt_4', price: 5 },
      { label: 'D', value: 'opt_4', price: 7 },
    ]);
    expect(fixed[1]).toEqual({ label: 'D', value: 'opt_4', price: 5 });
    expect(fixed[2]).toMatchObject({ label: 'D', price: 7 });
    expect(new Set(fixed.map((o) => o.value)).size).toBe(3);
  });

  it('flags no options, repeated values and blank names', () => {
    const single = { id: 'pick', type: 'single_choice', title: 'Pick one' };
    expect(kinds([{ ...single, options: [] } as Question])).toEqual([['no_options', true]]);
    expect(studioIssues([{ ...single, options: [] } as Question])[0]!.message).toBe(
      '“Pick one” has no options. Add at least one.',
    );
    const dup = [
      { label: 'A', value: 'opt_1' },
      { label: 'B', value: 'opt_1' },
    ];
    expect(kinds([{ ...single, options: dup } as Question])).toEqual([['same_option', true]]);
    expect(kinds([{ ...single, options: [{ label: ' ', value: 'a' }] } as Question])).toEqual([
      ['blank_option', false],
    ]);
    const grid = { id: 'g', type: 'matrix', title: 'Rate each', rows: [], columns: opts(2) };
    expect(studioIssues([grid as Question])[0]!.message).toBe(
      '“Rate each” needs at least one row and one column.',
    );
    // A checklist with no named shot is the engine's "no photos to take" — not said twice.
    const shots = {
      id: 'c',
      type: 'photo_checklist',
      title: 'Snap',
      items: [{ label: '', value: 'a' }],
    };
    expect(kinds([shots as Question])).toEqual([]);
  });
});

describe('lengths, files, steps', () => {
  it('a max length below 1 or with a decimal is a heads-up: the form reads it as no limit, or rounds down (R23)', () => {
    const q = (maxLength: number) =>
      ({ id: 't', type: 'short_text', title: 'Name?', maxLength }) as Question;
    for (const n of [0, -5, 1.5]) expect(kinds([q(n)])).toEqual([['bad_length', false]]);
    expect(kinds([q(10)])).toEqual([]);
    expect(studioIssues([q(0)])[0]!.message).toBe(
      '“Name?”: Max length 0 means no limit. Clear it, or use 1 or more.',
    );
    expect(studioIssues([q(2.5)])[0]!.message).toBe(
      '“Name?”: Max length 2.5 counts as 2 characters.',
    );
  });

  it('file size above 0 (blank = 32 MB); file count a whole number', () => {
    const f = (extra: Record<string, unknown>) =>
      ({ id: 'f', type: 'file_upload', title: 'Upload', ...extra }) as Question;
    // The form reads 0 MB as the usual 32 MB and 2.5 files as 2 (R23): heads-ups, not traps.
    expect(kinds([f({ maxSizeMb: 0 })])).toEqual([['bad_file_size', false]]);
    expect(kinds([f({ maxSizeMb: -1 })])).toEqual([['bad_file_size', false]]);
    expect(kinds([f({ maxSizeMb: 50 })])).toEqual([['bad_file_size', false]]);
    expect(kinds([f({ maxSizeMb: 0.5 })])).toEqual([]);
    expect(kinds([f({ maxFiles: 2.5 })])).toEqual([['bad_file_count', false]]);
    expect(kinds([f({ maxFiles: 0, multiple: false })])).toEqual([]);
    expect(studioIssues([f({ maxSizeMb: 0 })])[0]!.message).toBe(
      '“Upload”: Max size 0 MB means the usual 32 MB limit. Clear it, or use 1 MB or more.',
    );
    expect(studioIssues([f({ maxFiles: 2.5 })])[0]!.message).toBe(
      '“Upload”: Max files 2.5 counts as 2. Use a whole number, 1 or more.',
    );
    // File types the filter can't read are left out, and said (R22).
    expect(kinds([f({ accept: 'pdf, jpg' })])).toEqual([]);
    expect(studioIssues([f({ accept: 'pdf, documents' })])[0]).toMatchObject({
      kind: 'bad_accept',
      blocking: false,
      message:
        '“Upload”: “documents” isn’t a file type the form can read, so it’s left out. Use endings like pdf or jpg.',
    });
  });

  it('a number step has to be more than 0', () => {
    const n = (step: number) => ({ id: 'n', type: 'number', title: 'How many?', step }) as Question;
    expect(kinds([n(0)])).toEqual([['bad_step', true]]);
    expect(kinds([n(0.01)])).toEqual([]);
  });
});

describe('scale', () => {
  const scale = (extra: Record<string, unknown>) =>
    ({ id: 's', type: 'scale', title: 'Rate us', min: 0, max: 10, ...extra }) as Question;

  it('counts points', () => {
    expect(scalePointCount({ min: 0, max: 10 })).toBe(11);
    expect(scalePointCount({ min: 1, max: 5, step: 2 })).toBe(3);
    expect(scalePointCount({ min: 0, max: 10, step: 0 })).toBeNaN();
  });

  it('a 20,001-point scale or a step of 0 is refused (it would freeze the page)', () => {
    expect(kinds([scale({ max: 20000 })])).toEqual([['scale_points', true]]);
    expect(studioIssues([scale({ max: 20000 })])[0]!.message).toBe(
      '“Rate us” has 20,001 points, more than the form can show (101). Use fewer, or the Slider style.',
    );
    expect(kinds([scale({ step: 0 })])).toEqual([['bad_step', true]]);
    expect(kinds([scale({ max: 20 })])).toEqual([]);
  });

  it('a 0–100 scale draws in full: a heads-up, not a blocker; a slider is fine (R4, R10, R11)', () => {
    expect(kinds([scale({ max: 100 })])).toEqual([['scale_points', false]]);
    expect(studioIssues([scale({ max: 100 })])[0]!.message).toBe(
      '“Rate us” has 101 points to tap through. 21 or fewer reads better; the Slider style suits a long range.',
    );
    expect(kinds([scale({ max: 100, display: 'slider' })])).toEqual([]);
    expect(kinds([scale({ max: 100, step: 0.5, display: 'slider' })])).toEqual([]);
    // Only a slider step too fine to land on is said, and it never blocks.
    expect(kinds([scale({ max: 2_000_000, display: 'slider' })])).toEqual([
      ['scale_points', false],
    ]);
  });

  it('stars from 0 is a heads-up: the first star saves 0', () => {
    expect(kinds([scale({ display: 'stars', max: 4 })])).toEqual([['stars_from_zero', false]]);
    expect(kinds([scale({ display: 'stars', min: 1, max: 5 })])).toEqual([]);
  });
});

describe('redirect', () => {
  it('adds https:// to a bare domain and keeps full addresses', () => {
    expect(normalizeRedirectUrl('example.com/thank-you')).toBe('https://example.com/thank-you');
    expect(normalizeRedirectUrl(' www.example.com ')).toBe('https://www.example.com');
    expect(normalizeRedirectUrl('//example.com/x')).toBe('https://example.com/x');
    expect(normalizeRedirectUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
    expect(normalizeRedirectUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeRedirectUrl('http://example.com')).toBe('http://example.com');
  });

  it('refuses what can never be a web page link', () => {
    for (const bad of [
      'javascript:alert(1)',
      'mailto:a@b.co',
      '/thanks',
      'thanks',
      'https://',
      'exa mple.com',
      'localhost:3000',
    ]) {
      expect(normalizeRedirectUrl(bad)).toBeNull();
    }
  });

  it('a redirect respondents can’t reach blocks; one missing https:// says how to fix it', () => {
    const thanks = (redirectUrl: string) =>
      ({ id: 'done', type: 'thanks', title: 'Thanks!', redirectUrl }) as Question;
    const [bad] = studioIssues([thanks('javascript:alert(1)')]);
    expect(bad).toMatchObject({ kind: 'bad_redirect', blocking: true });
    expect(bad!.message).toBe(
      '“Thanks!” sends people to “javascript:alert(1)”, which isn’t a web address. Use a full one, like https://yoursite.com/thanks.',
    );
    // The form opens a bare address as https (R23): a heads-up with the address it will use.
    const [bare] = studioIssues([thanks('example.com/thank-you')]);
    expect(bare).toMatchObject({ kind: 'bad_redirect', blocking: false });
    expect(bare!.message).toContain('which opens as https://example.com/thank-you');
    expect(studioIssues([thanks('https://example.com/thank-you')])).toEqual([]);
  });
});

describe('phone country', () => {
  it('lists exactly the countries the phone check can read local numbers for', () => {
    expect([...PHONE_COUNTRIES].sort()).toEqual([...getCountries()].sort());
  });

  it('offers names, the usual countries first', () => {
    const list = phoneCountryOptions();
    expect(list.slice(0, 3).map((o) => o.value)).toEqual(['US', 'CA', 'MX']);
    expect(list[0]!.label).toBe('United States');
    expect(list).toHaveLength(PHONE_COUNTRIES.length);
  });

  it('an empty or unknown code is a heads-up: local numbers are read as US ones (R16)', () => {
    expect(isPhoneCountry('US')).toBe(true);
    for (const code of ['', 'XX', 'ZZ', 'us', '1']) {
      const q = { id: 'p', type: 'phone', title: 'Phone?', defaultCountry: code } as Question;
      expect(kinds([q])).toEqual([['bad_country', false]]);
    }
    expect(
      studioIssues([
        { id: 'p', type: 'phone', title: 'Phone?', defaultCountry: '' } as Question,
      ])[0]!.message,
    ).toBe(
      '“Phone?”: a number typed without its country code is read as a US number. Pick a country if most people answering aren’t in the US.',
    );
    expect(kinds([{ id: 'p', type: 'phone', title: 'Phone?' } as Question])).toEqual([]);
    const contact = { id: 'c', type: 'contact_info', title: 'Reach you?', defaultCountry: 'XX' };
    expect(kinds([contact as Question])).toEqual([['bad_country', false]]);
    expect(kinds([{ ...contact, fields: { phone: 'off' } } as Question])).toEqual([]);
  });
});

describe('sign-up slots', () => {
  const slot = (extra: Partial<SignupSlot>): SignupSlot => ({
    label: 'Morning',
    value: `s_${Math.random().toString(36).slice(2, 8)}`,
    capacity: 5,
    ...extra,
  });

  it('ends before it starts, a past day, and the same slot twice', () => {
    const slots = [
      slot({ date: '2026-10-10', start: '15:00', end: '11:00' }),
      slot({ label: 'Old', date: '2020-01-01', start: '09:00', end: '10:00' }),
      slot({ label: 'Swim', date: '2026-10-11', start: '09:00', end: '10:00' }),
      slot({ label: ' swim ', date: '2026-10-11', start: '09:00', end: '10:00' }),
      slot({ label: 'Snacks', date: '2026-10-11', start: '09:00', end: '10:00' }),
    ];
    expect(slotProblems(slots, '2026-10-04')).toEqual([
      { kind: 'times' },
      { kind: 'past' },
      null,
      { kind: 'twice', first: 2 },
      // Another job at the same time is fine (a potluck).
      null,
    ]);
    const q = { id: 'su', type: 'signup_slots', title: 'Pick a time', slots } as Question;
    const issues = studioIssues([q], '2026-10-04');
    expect(issues.map((i) => [i.kind, i.blocking])).toEqual([
      ['slot_times', false],
      ['slot_past', false],
      ['slot_twice', false],
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      '“Pick a time”: “Morning” ends before it starts.',
      '“Pick a time”: “Old” is on a day that has passed.',
      '“Pick a time”: “swim” is listed twice, at the same time.',
    ]);
  });
});

describe('formIssues', () => {
  it('lists engine and studio issues in form order, marking what blocks publishing', () => {
    const qs: Question[] = [
      { id: 'w', type: 'welcome', title: 'Hi' },
      { id: 'n', type: 'number', title: 'How many windows?', min: 10, max: 2 },
      multi({ min: 3, max: 2 }),
      {
        id: 'x',
        type: 'short_text',
        title: 'Anything else?',
        visibleIf: { field: 'deleted_one', op: 'is_not_empty' },
      },
      { id: 'done', type: 'thanks', title: 'Thanks!', redirectUrl: 'javascript:x' },
    ];
    const issues = formIssues(qs, '2026-10-04');
    expect(issues.map((i) => [i.questionId, i.kind, i.blocking])).toEqual([
      ['n', 'bad_bounds', true],
      ['services', 'pick_range', true],
      ['x', 'dangling_condition', false],
      ['done', 'bad_redirect', true],
    ]);
    for (const issue of issues) expectPlain(issue);
  });

  it('a clean form has nothing to fix', () => {
    expect(formIssues([multi({ min: 1, max: 2 })])).toEqual([]);
  });

  it('every studio message is in plain words', () => {
    const qs = [
      multi({ min: 9 }),
      multi({ max: 0, id: 'b' }),
      { id: 't', type: 'long_text', title: 'Story?', maxLength: 0 },
      { id: 'f', type: 'file_upload', title: 'Upload', maxSizeMb: -1, maxFiles: 0.5 },
      { id: 's', type: 'scale', title: 'Rate', min: 0, max: 99, display: 'stars' },
      { id: 'p', type: 'phone', title: 'Phone?', defaultCountry: 'XX' },
      { id: 'd', type: 'dropdown', title: 'Pick', options: [] },
    ] as Question[];
    const issues = studioIssues(qs, '2026-10-04');
    expect(issues.length).toBeGreaterThanOrEqual(8);
    for (const issue of issues) expectPlain(issue);
  });

  it('blocks on engine checks exactly as the editor’s banner does (one policy, decision 4)', () => {
    const qs = [
      {
        id: 'loop',
        type: 'short_text',
        title: 'Loop?',
        logic: [{ if: { field: 'loop', op: 'is_not_empty' }, goTo: 'loop' }],
      },
      { id: 'shots', type: 'photo_checklist', title: 'Photos', items: [] },
      { id: 'pin', type: 'image_pin', title: 'Mark it' },
      { id: 'pin2', type: 'image_pin', title: 'Mark it too', required: true },
      { id: 'slots', type: 'signup_slots', title: 'Pick a time', slots: [] },
    ] as Question[];
    const blocking = Object.fromEntries(formIssues(qs).map((i) => [i.questionId, i.blocking]));
    expect(blocking).toEqual({ loop: false, shots: false, pin: false, pin2: true, slots: true });
    expect(
      ownerIssues(qs)
        .map((i) => [i.questionId, i.blocking])
        .sort(),
    ).toEqual(Object.entries(blocking).sort());
  });
});
